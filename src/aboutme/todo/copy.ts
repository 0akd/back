// src/aboutme/todo/copy.ts
import { Hono } from 'hono';
import { Bindings } from './types';

export const copyRouter = new Hono<{ Bindings: Bindings }>();

copyRouter.post('/:id/copy', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    const { category_id } = await c.req.json();
    
    const { results } = await c.env.todo_db.prepare(`SELECT * FROM todos WHERE id = ?`).bind(id).all();
    if (results.length === 0) return c.json({ error: 'Todo not found' }, 404);
    
    const t = results[0] as any;
    const targetCat = category_id !== undefined ? category_id : t.category_id;
    
    const { success } = await c.env.todo_db.prepare(`
      INSERT INTO todos (title, description, position, steps, trial_level, category_id, target_value, lap_duration, lap_count_target, lap_current_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).bind(`${t.title} (Copy)`, t.description, t.position, t.steps, t.trial_level, targetCat, t.target_value, t.lap_duration, t.lap_count_target).run();
    
    return c.json({ success });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to copy todo' }, 500);
  }
});

copyRouter.post('/categories/:id/copy', async (c) => {
  try {
    const sourceId = parseInt(c.req.param('id'));
    const { parent_id } = await c.req.json();
    
    async function copyCategoryRecursive(db: D1Database, currentCatId: number, targetParentId: number | null, isRoot: boolean) {
      const { results: cats } = await db.prepare(`SELECT * FROM categories WHERE id = ?`).bind(currentCatId).all();
      if (cats.length === 0) return;
      const cat = cats[0] as any;
      
      const newName = isRoot ? `${cat.name} (Copy)` : cat.name;
      
      const { meta } = await db.prepare(`
        INSERT INTO categories (name, description, parent_id, position)
        VALUES (?, ?, ?, ?)
      `).bind(newName, cat.description, targetParentId, cat.position).run();
      
      const newCatId = meta.last_row_id;
      
      const { results: todos } = await db.prepare(`SELECT * FROM todos WHERE category_id = ?`).bind(currentCatId).all();
      for (const t of todos as any[]) {
        await db.prepare(`
          INSERT INTO todos (title, description, position, steps, trial_level, category_id, target_value, lap_duration, lap_count_target, lap_current_count)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `).bind(t.title, t.description, t.position, t.steps, t.trial_level, newCatId, t.target_value, t.lap_duration, t.lap_count_target).run();
      }
      
      const { results: subcats } = await db.prepare(`SELECT id FROM categories WHERE parent_id = ?`).bind(currentCatId).all();
      for (const sub of subcats as any[]) {
        await copyCategoryRecursive(db, sub.id, newCatId, false);
      }
    }
    
    const targetParent = parent_id !== undefined ? parent_id : null;
    await copyCategoryRecursive(c.env.todo_db, sourceId, targetParent, true);
    
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to copy category tree' }, 500);
  }
});