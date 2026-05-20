import { Hono } from 'hono'

type Bindings = {
  todo_db: D1Database // <-- Updated to use the shared database
}

export const news = new Hono<{ Bindings: Bindings }>()

// CREATE
news.post('/', async (c) => {
  const { headline, content } = await c.req.json()
  
  if (!headline || !content) return c.json({ error: 'Missing data' }, 400)

  const { success } = await c.env.todo_db.prepare(
    `INSERT INTO news (headline, content) VALUES (?, ?)`
  ).bind(headline, content).run()

  if (success) return c.json({ message: 'News created' }, 201)
  return c.json({ error: 'Creation failed' }, 500)
})

// READ ALL
news.get('/', async (c) => {
  const { results } = await c.env.todo_db.prepare(
    `SELECT * FROM news ORDER BY created_at DESC`
  ).all()
  return c.json(results)
})

// READ SINGLE
news.get('/:id', async (c) => {
  const id = c.req.param('id')
  const article = await c.env.todo_db.prepare(
    `SELECT * FROM news WHERE id = ?`
  ).bind(id).first()
  
  if (!article) return c.json({ error: 'Not found' }, 404)
  return c.json(article)
})

// UPDATE
news.put('/:id', async (c) => {
  const id = c.req.param('id')
  const { headline, content } = await c.req.json()
  
  const { success } = await c.env.todo_db.prepare(
    `UPDATE news SET headline = COALESCE(?, headline), content = COALESCE(?, content) WHERE id = ?`
  ).bind(headline, content, id).run()

  if (success) return c.json({ message: 'Updated' })
  return c.json({ error: 'Update failed' }, 500)
})

// DELETE
news.delete('/:id', async (c) => {
  const id = c.req.param('id')
  
  const { success } = await c.env.todo_db.prepare(
    `DELETE FROM news WHERE id = ?`
  ).bind(id).run()
  
  if (success) return c.json({ message: 'Deleted' })
  return c.json({ error: 'Delete failed' }, 500)
})