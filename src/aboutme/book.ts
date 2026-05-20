// src/aboutme/book.ts
import { Hono } from 'hono'

type Book = {
  id?: number
  name: string
  cdn_link: string
  created_at?: string
  current_page?: number
}

export const book = new Hono<{
  Bindings: {
    todo_db: D1Database
  }
}>()

// =============================================
// GET /api/books - List all books (now includes current_page)
// =============================================
book.get('/', async (c) => {
  const { results } = await c.env.todo_db
    .prepare('SELECT id, name, cdn_link, created_at, current_page FROM books ORDER BY created_at DESC')
    .all<Book>()
  return c.json(results)
})

// =============================================
// GET /api/books/:id - Get single book
// =============================================
book.get('/:id', async (c) => {
  const id = c.req.param('id')
  const bookData = await c.env.todo_db
    .prepare('SELECT id, name, cdn_link, created_at, current_page FROM books WHERE id = ?')
    .bind(id)
    .first<Book>()
  if (!bookData) return c.json({ error: 'Book not found' }, 404)
  return c.json(bookData)
})

// =============================================
// POST /api/books - Add new book (Admin)
// =============================================
book.post('/', async (c) => {
  const body = await c.req.json<Book>()
  if (!body.name || !body.cdn_link) {
    return c.json({ error: 'name and cdn_link are required' }, 400)
  }

  const result = await c.env.todo_db
    .prepare(`INSERT INTO books (name, cdn_link, created_at, current_page) VALUES (?, ?, datetime('now'), 1)`)
    .bind(body.name, body.cdn_link)
    .run()

  return c.json({ success: true, id: result.meta.last_row_id }, 201)
})

// =============================================
// DELETE /api/books/:id - Delete book (Admin)
// =============================================
book.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const result = await c.env.todo_db
    .prepare('DELETE FROM books WHERE id = ?')
    .bind(id)
    .run()

  if (result.meta.rows_written === 0) {
    return c.json({ error: 'Book not found' }, 404)
  }
  return c.json({ success: true, message: 'Book deleted' })
})

// =============================================
// POST /api/books/:id/progress - Save current reading page (NEW)
// This is what UserBookLibrary.astro uses
// =============================================
book.post('/:id/progress', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()

  const current_page = parseInt(body.current_page)
  if (!current_page || current_page < 1) {
    return c.json({ error: 'current_page must be a positive number' }, 400)
  }

  const result = await c.env.todo_db
    .prepare('UPDATE books SET current_page = ? WHERE id = ?')
    .bind(current_page, id)
    .run()

  if (result.meta.changes === 0) {
    return c.json({ error: 'Book not found' }, 404)
  }

  return c.json({ 
    success: true, 
    message: 'Reading progress saved',
    current_page 
  })
})

// =============================================
// PATCH /api/books/:id - Update book (optional)
// =============================================
book.patch('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()

  const updates: string[] = []
  const values: any[] = []

  if (body.name) {
    updates.push('name = ?')
    values.push(body.name)
  }
  if (body.cdn_link) {
    updates.push('cdn_link = ?')
    values.push(body.cdn_link)
  }
  if (body.current_page !== undefined) {
    updates.push('current_page = ?')
    values.push(parseInt(body.current_page))
  }

  if (updates.length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400)
  }

  values.push(id)

  const result = await c.env.todo_db
    .prepare(`UPDATE books SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run()

  if (result.meta.changes === 0) {
    return c.json({ error: 'Book not found' }, 404)
  }

  return c.json({ success: true, message: 'Book updated' })
})

// =============================================
// Seed endpoint (kept from your original)
// =============================================
book.post('/seed', async (c) => {
  const name = "Ego: Understanding the Self (Acharya Prashant)"
  const cdn_link = "https://cdn.jsdelivr.net/gh/0akd/book@main/ap/Ego%20Understanding%20the%20self%20(Acharya%20Prashant)%20(z-library.sk%2C%201lib.sk%2C%20z-lib.sk).pdf"

  const existing = await c.env.todo_db
    .prepare('SELECT id FROM books WHERE name = ?')
    .bind(name)
    .first()

  if (existing) return c.json({ message: 'Already seeded', id: existing.id })

  const result = await c.env.todo_db
    .prepare(`INSERT INTO books (name, cdn_link, created_at, current_page) VALUES (?, ?, datetime('now'), 1)`)
    .bind(name, cdn_link)
    .run()

  return c.json({ success: true, id: result.meta.last_row_id })
})