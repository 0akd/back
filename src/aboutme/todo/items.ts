// src/aboutme/todo/items.ts
import { Hono } from 'hono';
import { Bindings } from './types';
import { normalizeSteps, normalizeTrialLevel, parseSteps, stringifySteps } from './helpers';

export const itemsRouter = new Hono<{ Bindings: Bindings }>();

// src/aboutme/todo/items.ts (Update the reset route)

itemsRouter.put('/reset', async (c) => {
  try {
    // Fetched trial_level so we can record the unfinished counter
    const { results: todos } = await c.env.todo_db.prepare(`SELECT id, completed, trial_level, history_json FROM todos`).all();

    const stmts = todos.map((t: any) => {
      let history = [];
      try {
        history = t.history_json ? JSON.parse(t.history_json) : [];
      } catch (e) {}

      const isCompleted = !!t.completed;
      
      // Only record 'completed' and 'count' (no date)
      const historyEntry: any = { 
        completed: isCompleted 
      };

      // Only record the counter number if the task was NOT finished
      if (!isCompleted) {
        historyEntry.count = t.trial_level || 0;
      }

      // 1. QUEUE LOGIC: Always append the new reset action to the end
      history.push(historyEntry);

      // 2. QUEUE LOGIC: Keep only the 7 most recent resets (Drops the oldest)
      if (history.length > 7) {
        history = history.slice(-7);
      }

      return c.env.todo_db.prepare(`
        UPDATE todos 
        SET completed = 0, trial_level = 0, lap_current_count = 0, history_json = ? 
        WHERE id = ?
      `).bind(JSON.stringify(history), t.id);
    });

    if (stmts.length > 0) {
      await c.env.todo_db.batch(stmts);
    }

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message || 'Reset failed' }, 500);
  }
});

itemsRouter.post('/', async (c) => {
  const { title, description, position, steps = [], trial_level, category_id, whiteboard_json, target_value, lap_duration, lap_count_target, lap_current_count } = await c.req.json();
  if (!title?.trim()) return c.json({ error: 'title is required' }, 400);

  const catId = category_id ?? null;
  const targetPosition = position ?? 0;

  if (catId === null) {
    await c.env.todo_db.prepare(`
      UPDATE todos SET position = position + 1 
      WHERE category_id IS NULL AND position >= ?
    `).bind(targetPosition).run();
  } else {
    await c.env.todo_db.prepare(`
      UPDATE todos SET position = position + 1 
      WHERE category_id = ? AND position >= ?
    `).bind(catId, targetPosition).run();
  }

  const normalizedSteps = normalizeSteps(steps);
  const tl = normalizeTrialLevel(trial_level);
  const desc = description ?? null;
  const wbJson = whiteboard_json ?? null;
  const tVal = target_value ?? null;
  const lDuration = lap_duration ?? null;
  const lCountTarget = lap_count_target ?? null;
  const lCurrentCount = lap_current_count ?? 0;

  const { success, meta } = await c.env.todo_db.prepare(`
    INSERT INTO todos (title, description, position, steps, trial_level, category_id, whiteboard_json, target_value, lap_duration, lap_count_target, lap_current_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(title.trim(), desc, targetPosition, stringifySteps(normalizedSteps), tl, catId, wbJson, tVal, lDuration, lCountTarget, lCurrentCount).run();

  return c.json({ success, id: meta?.last_row_id }, 201);
});

itemsRouter.get('/', async (c) => {
  try {
    const { results } = await c.env.todo_db.prepare(`
      SELECT t.*, c.name as category_name
      FROM todos t
      LEFT JOIN categories c ON t.category_id = c.id
      ORDER BY t.position ASC, t.created_at DESC
    `).all();
    
    const todosWithSteps = results.map((t: any) => {
      let parsedHistory = [];
      try {
        parsedHistory = t.history_json ? JSON.parse(t.history_json) : [];
      } catch(e) {}

      return {
        ...t,
        completed: !!t.completed,
        trial_level: t.trial_level ?? 0,
        target_value: t.target_value ?? null,
        lap_duration: t.lap_duration ?? null,
        lap_count_target: t.lap_count_target ?? null,
        lap_current_count: t.lap_current_count ?? 0,
        category_id: t.category_id ?? null,
        category_name: t.category_name ?? null,
        steps: normalizeSteps(parseSteps(t.steps)),
        whiteboard_json: t.whiteboard_json ?? null,
        history: parsedHistory
      };
    });
    
    return c.json(todosWithSteps);
  } catch (err: any) {
    return c.json({ error: err.message || 'Database query failed' }, 500);
  }
});

itemsRouter.put('/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    const { title, description, completed, position, steps, trial_level, category_id, whiteboard_json, target_value, lap_duration, lap_count_target, lap_current_count } = await c.req.json();

    const { results: currentRows } = await c.env.todo_db.prepare('SELECT * FROM todos WHERE id = ?').bind(id).all();
    if (currentRows.length === 0) return c.json({ error: 'Todo not found' }, 404);
    const currentTodo = currentRows[0] as any;

    const updates: string[] = [];
    const values: any[] = [];

    const hasCatUpdate = category_id !== undefined;
    const hasPosUpdate = position !== undefined;

    if (hasCatUpdate || hasPosUpdate) {
      const finalCatId = hasCatUpdate ? (category_id ?? null) : currentTodo.category_id;
      let finalPos = hasPosUpdate ? position : currentTodo.position;

      const catChanged = hasCatUpdate && finalCatId !== currentTodo.category_id;
      const posChanged = hasPosUpdate && finalPos !== currentTodo.position;

      if (catChanged || posChanged) {
        if (catChanged) {
          const oldCat = currentTodo.category_id;
          const oldPos = currentTodo.position;
          if (oldCat === null) {
            await c.env.todo_db.prepare(`UPDATE todos SET position = position - 1 WHERE category_id IS NULL AND position > ?`).bind(oldPos).run();
          } else {
            await c.env.todo_db.prepare(`UPDATE todos SET position = position - 1 WHERE category_id = ? AND position > ?`).bind(oldCat, oldPos).run();
          }

          if (!hasPosUpdate) {
            let maxPos = -1;
            if (finalCatId === null) {
              const r = await c.env.todo_db.prepare(`SELECT MAX(position) as maxp FROM todos WHERE category_id IS NULL`).all();
              maxPos = r.results[0]?.maxp ?? -1;
            } else {
              const r = await c.env.todo_db.prepare(`SELECT MAX(position) as maxp FROM todos WHERE category_id = ?`).bind(finalCatId).all();
              maxPos = r.results[0]?.maxp ?? -1;
            }
            finalPos = maxPos + 1;
          } else {
            if (finalCatId === null) {
              await c.env.todo_db.prepare(`UPDATE todos SET position = position + 1 WHERE category_id IS NULL AND position >= ?`).bind(finalPos).run();
            } else {
              await c.env.todo_db.prepare(`UPDATE todos SET position = position + 1 WHERE category_id = ? AND position >= ?`).bind(finalCatId, finalPos).run();
            }
          }
        } else if (posChanged) {
          const cat = currentTodo.category_id;
          const oldP = currentTodo.position;
          const newP = finalPos;
          if (newP > oldP) {
            if (cat === null) {
              await c.env.todo_db.prepare(`UPDATE todos SET position = position - 1 WHERE category_id IS NULL AND position > ? AND position <= ?`).bind(oldP, newP).run();
            } else {
              await c.env.todo_db.prepare(`UPDATE todos SET position = position - 1 WHERE category_id = ? AND position > ? AND position <= ?`).bind(cat, oldP, newP).run();
            }
          } else {
            if (cat === null) {
              await c.env.todo_db.prepare(`UPDATE todos SET position = position + 1 WHERE category_id IS NULL AND position < ? AND position >= ?`).bind(oldP, newP).run();
            } else {
              await c.env.todo_db.prepare(`UPDATE todos SET position = position + 1 WHERE category_id = ? AND position < ? AND position >= ?`).bind(cat, oldP, newP).run();
            }
          }
        }
      }

      if (hasCatUpdate) { updates.push('category_id = ?'); values.push(finalCatId); }
      if (hasPosUpdate || catChanged) { updates.push('position = ?'); values.push(finalPos); }
    }

    if (title !== undefined) { updates.push('title = ?'); values.push(title); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (steps !== undefined) { updates.push('steps = ?'); values.push(stringifySteps(normalizeSteps(steps))); }
    if (whiteboard_json !== undefined) { updates.push('whiteboard_json = ?'); values.push(whiteboard_json === null ? null : whiteboard_json); }
    if (target_value !== undefined) { updates.push('target_value = ?'); values.push(target_value === null ? null : parseInt(String(target_value), 10)); }
    if (lap_duration !== undefined) { updates.push('lap_duration = ?'); values.push(lap_duration === null ? null : parseInt(String(lap_duration), 10)); }
    if (lap_count_target !== undefined) { updates.push('lap_count_target = ?'); values.push(lap_count_target === null ? null : parseInt(String(lap_count_target), 10)); }
    if (lap_current_count !== undefined) { updates.push('lap_current_count = ?'); values.push(parseInt(String(lap_current_count), 10) || 0); }

    let finalCompleted = currentTodo.completed;
    if (completed !== undefined) {
      finalCompleted = completed ? 1 : 0;
    }

    let newTrialLevel = currentTodo.trial_level;
    if (trial_level !== undefined) {
      newTrialLevel = normalizeTrialLevel(trial_level);
      updates.push('trial_level = ?');
      values.push(newTrialLevel);
    }

    let newTarget = currentTodo.target_value;
    if (target_value !== undefined) {
      newTarget = target_value === null ? null : parseInt(String(target_value), 10);
    }

    if (completed === undefined) {
      if (newTarget !== null && newTarget > 0) {
        if (newTrialLevel >= newTarget) {
          finalCompleted = 1;
        } else {
          finalCompleted = 0;
        }
      }
    }

    updates.push('completed = ?');
    values.push(finalCompleted);

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