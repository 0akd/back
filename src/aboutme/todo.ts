import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { asc, desc, eq } from 'drizzle-orm';
import { todos } from '../db/schema'; 

type Bindings = {
  todo_db: D1Database;
  JWT_SECRET: string;
};

const todo = new Hono<{ Bindings: Bindings }>();

// PUT /reset (Uncheck all todos) - MUST BE DECLARED BEFORE /:id
todo.put('/reset', async (c) => {
  try {
    const db = drizzle(c.env.todo_db);
    
    await db.update(todos).set({ completed: false });
    
    return c.json({ success: true });
  } catch (err: any) {
    console.error("🔥 Reset Error:", err.message);
    return c.json({ error: err.message || 'Reset failed' }, 500);
  }
});

// POST / (Create new todo with position shift)
todo.post('/', async (c) => {
  const { title, position } = await c.req.json();
  
  if (position !== undefined) {
    await c.env.todo_db.prepare(
      `UPDATE todos SET position = position + 1 WHERE position >= ?`
    ).bind(position).run();
  }

  const targetPosition = position ?? 0;

  const { success } = await c.env.todo_db.prepare(
    `INSERT INTO todos (title, position) VALUES (?, ?)`
  ).bind(title, targetPosition).run();
  
  return c.json({ success }, 201);
});

// GET / 
todo.get('/', async (c) => {
  try {
    const db = drizzle(c.env.todo_db);
    
    const results = await db.select()
      .from(todos)
      .orderBy(asc(todos.position), desc(todos.createdAt));
    
    return c.json(results);
  } catch (err: any) {
    console.error("🔥 Drizzle/Database Error:", err.message);
    return c.json({ error: err.message || 'Database query failed' }, 500);
  }
});

// PUT /:id (Update title, completed, and/or position)
todo.put('/:id', async (c) => {
  try {
    const db = drizzle(c.env.todo_db);
    const id = parseInt(c.req.param('id')); 
    const { title, completed, position } = await c.req.json();
    
    const updateData: any = {};
    if (title !== undefined) updateData.title = title;
    if (completed !== undefined) updateData.completed = completed;
    if (position !== undefined) updateData.position = position;

    if (Object.keys(updateData).length === 0) {
      return c.json({ error: 'No fields provided for update' }, 400);
    }

    const result = await db.update(todos)
      .set(updateData)
      .where(eq(todos.id, id))
      .returning(); 

    if (result.length === 0) {
      return c.json({ error: 'Todo not found' }, 404);
    }
    
    return c.json({ success: true, data: result[0] });
  } catch (err: any) {
    console.error("🔥 Update Error:", err.message);
    return c.json({ error: err.message || 'Update failed' }, 500);
  }
});

// DELETE /:id
todo.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const { success } = await c.env.todo_db.prepare(
    `DELETE FROM todos WHERE id = ?`
  ).bind(id).run();
  
  return c.json({ success });
});

export { todo };