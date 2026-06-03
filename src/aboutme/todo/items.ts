// src/aboutme/todo/items.ts
import { Hono } from 'hono';
import { Bindings } from './types';
import { normalizeSteps, normalizeTrialLevel, parseSteps, stringifySteps } from './helpers';

export const itemsRouter = new Hono<{ Bindings: Bindings }>();

itemsRouter.put('/reset', async (c) => {
  try {
    await c.env.todo_db.prepare(`UPDATE todos SET completed = 0, trial_level = 0`).run();
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message || 'Reset failed' }, 500);
  }
});

itemsRouter.post('/', async (c) => {
  const { title, description, position, steps = [], trial_level, category_id, whiteboard_json } = await c.req.json();
  
  if (position !== undefined) {
    await c.env.todo_db.prepare(`UPDATE todos SET position = position + 1 WHERE position >= ?`).bind(position).run();
  }
  
  const targetPosition = position ?? 0;
  const normalizedSteps = normalizeSteps(steps);
  const tl = normalizeTrialLevel(trial_level);
  const catId = category_id ?? null;
  const desc = description ?? null;
  const wbJson = whiteboard_json ?? null;

  const { success } = await c.env.todo_db.prepare(`
    INSERT INTO todos (title, description, position, steps, trial_level, category_id, whiteboard_json) 
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(title, desc, targetPosition, stringifySteps(normalizedSteps), tl, catId, wbJson).run();
  
  return c.json({ success }, 201);
});

itemsRouter.get('/', async (c) => {
  try {
    const { results } = await c.env.todo_db.prepare(`
      SELECT t.*, c.name as category_name 
      FROM todos t 
      LEFT JOIN categories c ON t.category_id = c.id 
      ORDER BY t.position ASC, t.created_at DESC
    `).all();

    const todosWithSteps = results.map((t: any) => ({
      ...t,
      completed: !!t.completed,
      trial_level: t.trial_level ?? 0,
      category_id: t.category_id ?? null,
      category_name: t.category_name ?? null,
      steps: normalizeSteps(parseSteps(t.steps)),
      whiteboard_json: t.whiteboard_json ?? null
    }));
    return c.json(todosWithSteps);
  } catch (err: any) {
    return c.json({ error: err.message || 'Database query failed' }, 500);
  }
});

itemsRouter.put('/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    const { title, description, completed, position, steps, trial_level, category_id, whiteboard_json } = await c.req.json();
    const updates: string[] = [];
    const values: any[] = [];

    if (position !== undefined) {
      const { results: current } = await c.env.todo_db.prepare('SELECT position FROM todos WHERE id = ?').bind(id).all();
      if (current.length > 0) {
        const oldPos = current[0].position;
        if (oldPos !== position) {
          if (position > oldPos) {
            await c.env.todo_db.prepare(`UPDATE todos SET position = position - 1 WHERE position > ? AND position <= ?`).bind(oldPos, position).run();
          } else {
            await c.env.todo_db.prepare(`UPDATE todos SET position = position + 1 WHERE position < ? AND position >= ?`).bind(oldPos, position).run();
          }
        }
      }
      updates.push('position = ?');
      values.push(position);
    }

    if (title !== undefined) { updates.push('title = ?'); values.push(title); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (completed !== undefined) { updates.push('completed = ?'); values.push(completed ? 1 : 0); }
    if (steps !== undefined) {
      updates.push('steps = ?');
      values.push(stringifySteps(normalizeSteps(steps)));
    }
    if (trial_level !== undefined) {
      updates.push('trial_level = ?');
      values.push(normalizeTrialLevel(trial_level));
    }
    if (category_id !== undefined) {
      updates.push('category_id = ?');
      values.push(category_id ?? null);
    }
    if (whiteboard_json !== undefined) {
      updates.push('whiteboard_json = ?');
      values.push(whiteboard_json === null ? null : whiteboard_json);
    }

    if (updates.length === 0) return c.json({ error: 'No fields provided for update' }, 400);
    values.push(id);

    const { success } = await c.env.todo_db.prepare(`
      UPDATE todos SET ${updates.join(', ')} WHERE id = ?
    `).bind(...values).run();
    if (!success) return c.json({ error: 'Todo not found' }, 404);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message || 'Update failed' }, 500);
  }
});

itemsRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const { success } = await c.env.todo_db.prepare(`DELETE FROM todos WHERE id = ?`).bind(id).run();
  return c.json({ success });
});