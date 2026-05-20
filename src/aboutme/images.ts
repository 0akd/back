import { Hono } from 'hono'

type Bindings = {
  todo_db: D1Database 
}

export const images = new Hono<{ Bindings: Bindings }>()

// CREATE
images.post('/', async (c) => {
  const { base64_data, position = 0 } = await c.req.json()
  
  if (!base64_data) return c.json({ error: 'Missing base64 data' }, 400)

  let finalBase64 = base64_data.replace(/\s+/g, '')
  if (!finalBase64.startsWith('data:image')) {
    finalBase64 = `data:image/png;base64,${finalBase64}`
  }

  const filename = `img_${Date.now()}.png`

  const { success } = await c.env.todo_db.prepare(
    `INSERT INTO images (filename, base64_data, position) VALUES (?, ?, ?)`
  ).bind(filename, finalBase64, position).run()

  if (success) return c.json({ message: 'Image created' }, 201)
  return c.json({ error: 'Creation failed' }, 500)
})

// READ ALL (Metadata + Position)
images.get('/', async (c) => {
  const { results } = await c.env.todo_db.prepare(
    `SELECT id, filename, position, created_at FROM images ORDER BY position ASC, created_at DESC`
  ).all()
  return c.json(results)
})

// READ SINGLE
images.get('/:id', async (c) => {
  const id = c.req.param('id')
  const image = await c.env.todo_db.prepare(
    `SELECT * FROM images WHERE id = ?`
  ).bind(id).first()
  
  if (!image) return c.json({ error: 'Not found' }, 404)
  return c.json(image)
})

// UPDATE (Include Position)
images.put('/:id', async (c) => {
  const id = c.req.param('id')
  const { filename = null, base64_data = null, position = null } = await c.req.json()
  
  const { success } = await c.env.todo_db.prepare(
    `UPDATE images SET 
      filename = COALESCE(?, filename), 
      base64_data = COALESCE(?, base64_data),
      position = COALESCE(?, position) 
    WHERE id = ?`
  ).bind(filename, base64_data, position, id).run()
  
  if (success) return c.json({ message: 'Updated' })
  return c.json({ error: 'Update failed' }, 500)
})

// DELETE
images.delete('/:id', async (c) => {
  const id = c.req.param('id')
  
  const { success } = await c.env.todo_db.prepare(
    `DELETE FROM images WHERE id = ?`
  ).bind(id).run()
  
  if (success) return c.json({ message: 'Deleted' })
  return c.json({ error: 'Delete failed' }, 500)
})