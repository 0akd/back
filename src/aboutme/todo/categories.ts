// src/aboutme/todo/categories.ts
import { Hono } from 'hono';
import { Bindings } from './types';
import { buildCategoryTree, getDescendantCategoryIds, normalizeSteps, parseSteps } from './helpers';

export const categoriesRouter = new Hono<{ Bindings: Bindings }>();

categoriesRouter.get('/categories', async (c) => {
  try {
    const { results } = await c.env.todo_db.prepare(`
      SELECT * FROM categories ORDER BY COALESCE(parent_id, -1), position ASC, created_at ASC
    `).all();
    const tree = buildCategoryTree(results);
    return c.json({ success: true, data: tree });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to fetch category tree' }, 500);
  }
});

categoriesRouter.get('/categories/flat', async (c) => {
  try {
    const { results } = await c.env.todo_db.prepare(`
      SELECT * FROM categories ORDER BY COALESCE(parent_id, -1), position ASC, id ASC
    `).all();
    return c.json({ success: true, data: results });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to fetch categories' }, 500);
  }
});

categoriesRouter.post('/categories', async (c) => {
  try {
    const { name, parent_id, position, description } = await c.req.json();
    if (!name?.trim()) return c.json({ error: 'name is required' }, 400);
    const targetPosition = position ?? 0;
    const parentFilter = parent_id ?? null;
    const desc = description ?? null;

    if (parentFilter !== null) {
      await c.env.todo_db.prepare(`UPDATE categories SET position = position + 1 WHERE parent_id = ? AND position >= ?`).bind(parentFilter, targetPosition).run();
    } else {
      await c.env.todo_db.prepare(`UPDATE categories SET position = position + 1 WHERE parent_id IS NULL AND position >= ?`).bind(targetPosition).run();
    }

    const { success, meta } = await c.env.todo_db.prepare(`
      INSERT INTO categories (name, parent_id, position, description) VALUES (?, ?, ?, ?)
    `).bind(name.trim(), parentFilter, targetPosition, desc).run();
    return c.json({ success, id: meta?.last_row_id }, 201);
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to create category' }, 500);
  }
});

categoriesRouter.put('/categories/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    const { name, parent_id, position, description } = await c.req.json();
    
    // 1. Fetch current category state
    const { results: currentCats } = await c.env.todo_db.prepare(`SELECT parent_id, position FROM categories WHERE id = ?`).bind(id).all();
    if (currentCats.length === 0) return c.json({ error: 'Category not found' }, 404);
    
    const current = currentCats[0] as any;
    let newParentId = current.parent_id;
    let newPosition = current.position;
    let parentChanged = false;

    // 2. Validate and identify parent_id shifts
    if (parent_id !== undefined) {
      if (parent_id !== null) {
        if (parent_id === id) return c.json({ error: 'Cannot move a folder into itself' }, 400);
        const descendants = await getDescendantCategoryIds(c.env.todo_db, id);
        if (descendants.includes(parent_id)) {
          return c.json({ error: 'Cannot move folder into its own sub-folder' }, 400);
        }
      }
      if (parent_id !== current.parent_id) {
        newParentId = parent_id ?? null;
        parentChanged = true;
      }
    }

    if (position !== undefined && position !== current.position) {
      newPosition = position;
    }

    // 3. Shift logic for positions
    if (parentChanged) {
      // Remove from old parent's sequence
      if (current.parent_id !== null) {
        await c.env.todo_db.prepare(`UPDATE categories SET position = position - 1 WHERE parent_id = ? AND position > ?`).bind(current.parent_id, current.position).run();
      } else {
        await c.env.todo_db.prepare(`UPDATE categories SET position = position - 1 WHERE parent_id IS NULL AND position > ?`).bind(current.position).run();
      }
      
      // Make room in new parent's sequence
      if (newParentId !== null) {
        await c.env.todo_db.prepare(`UPDATE categories SET position = position + 1 WHERE parent_id = ? AND position >= ?`).bind(newParentId, newPosition).run();
      } else {
        await c.env.todo_db.prepare(`UPDATE categories SET position = position + 1 WHERE parent_id IS NULL AND position >= ?`).bind(newPosition).run();
      }
    } else if (newPosition !== current.position) {
      // Shifting position within the same parent
      const pId = current.parent_id;
      if (newPosition > current.position) {
        if (pId !== null) {
          await c.env.todo_db.prepare(`UPDATE categories SET position = position - 1 WHERE parent_id = ? AND position > ? AND position <= ?`).bind(pId, current.position, newPosition).run();
        } else {
          await c.env.todo_db.prepare(`UPDATE categories SET position = position - 1 WHERE parent_id IS NULL AND position > ? AND position <= ?`).bind(current.position, newPosition).run();
        }
      } else {
        if (pId !== null) {
          await c.env.todo_db.prepare(`UPDATE categories SET position = position + 1 WHERE parent_id = ? AND position < ? AND position >= ?`).bind(pId, current.position, newPosition).run();
        } else {
          await c.env.todo_db.prepare(`UPDATE categories SET position = position + 1 WHERE parent_id IS NULL AND position < ? AND position >= ?`).bind(current.position, newPosition).run();
        }
      }
    }

    // 4. Update the actual category
    const updates: string[] = [];
    const values: any[] = [];

    if (name !== undefined) { updates.push('name = ?'); values.push(name.trim()); }
    if (parent_id !== undefined) { updates.push('parent_id = ?'); values.push(newParentId); }
    if (position !== undefined || parentChanged) { updates.push('position = ?'); values.push(newPosition); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }

    if (updates.length === 0) return c.json({ error: 'No fields provided for update' }, 400);
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    await c.env.todo_db.prepare(`UPDATE categories SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message || 'Update failed' }, 500);
  }
});

categoriesRouter.delete('/categories/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    const cascade = c.req.query('cascade') === 'true';

    // 1. Get category info before deletion to shift siblings later
    const { results: targetCats } = await c.env.todo_db.prepare(`SELECT parent_id, position FROM categories WHERE id = ?`).bind(id).all();
    if (targetCats.length === 0) return c.json({ error: 'Category not found' }, 404);
    const target = targetCats[0] as any;

    if (cascade) {
      const deleteCascade = async (catId: number) => {
        const { results: children } = await c.env.todo_db.prepare(`SELECT id FROM categories WHERE parent_id = ?`).bind(catId).all();
        for (const child of children) await deleteCascade(child.id as number);
        await c.env.todo_db.prepare(`UPDATE todos SET category_id = NULL WHERE category_id = ?`).bind(catId).run();
        await c.env.todo_db.prepare(`DELETE FROM categories WHERE id = ?`).bind(catId).run();
      };
      await deleteCascade(id);
    } else {
      const { results: children } = await c.env.todo_db.prepare(`SELECT COUNT(*) as count FROM categories WHERE parent_id = ?`).bind(id).all();
      if ((children[0] as any).count > 0) {
        return c.json({ error: 'Cannot delete: has subcategories. Use ?cascade=true' }, 400);
      }
      await c.env.todo_db.prepare(`UPDATE todos SET category_id = NULL WHERE category_id = ?`).bind(id).run();
      await c.env.todo_db.prepare(`DELETE FROM categories WHERE id = ?`).bind(id).run();
    }

    // 2. Shift sibling positions down
    if (target.parent_id !== null) {
      await c.env.todo_db.prepare(`UPDATE categories SET position = position - 1 WHERE parent_id = ? AND position > ?`).bind(target.parent_id, target.position).run();
    } else {
      await c.env.todo_db.prepare(`UPDATE categories SET position = position - 1 WHERE parent_id IS NULL AND position > ?`).bind(target.position).run();
    }

    return c.json({ success: true, message: cascade ? 'Category and all descendants deleted' : 'Category deleted successfully' });
  } catch (err: any) {
    return c.json({ error: err.message || 'Delete failed' }, 500);
  }
});

categoriesRouter.get('/categories/:id/description', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    const { results } = await c.env.todo_db.prepare(`SELECT description FROM categories WHERE id = ?`).bind(id).all();
    if (results.length === 0) return c.json({ error: 'Category not found' }, 404);
    
    return c.json({ success: true, data: { description: results[0].description } });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to fetch category description' }, 500);
  }
});

categoriesRouter.put('/categories/:id/description', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    const { description } = await c.req.json();
    
    if (description === undefined) return c.json({ error: 'description is required' }, 400);

    const { success } = await c.env.todo_db.prepare(`
      UPDATE categories SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(description, id).run();

    if (!success) return c.json({ error: 'Category not found' }, 404);
    return c.json({ success: true, data: { description } });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to update category description' }, 500);
  }
});

categoriesRouter.delete('/categories/:id/description', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    const { success } = await c.env.todo_db.prepare(`
      UPDATE categories SET description = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(id).run();

    if (!success) return c.json({ error: 'Category not found' }, 404);
    return c.json({ success: true, message: 'Description deleted' });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to delete category description' }, 500);
  }
});

categoriesRouter.get('/categories/:id/todos', async (c) => {
  try {
    const catId = parseInt(c.req.param('id'));
    const includeSubtree = c.req.query('includeSubtree') === 'true';

    let whereClause = 'category_id = ?';
    let bindValues: any[] = [catId];

    if (includeSubtree) {
      const descendantIds = await getDescendantCategoryIds(c.env.todo_db, catId);
      if (descendantIds.length > 1) {
        const placeholders = descendantIds.map(() => '?').join(', ');
        whereClause = `category_id IN (${placeholders})`;
        bindValues = descendantIds;
      }
    }

    const { results } = await c.env.todo_db.prepare(`
      SELECT * FROM todos 
      WHERE ${whereClause} 
      ORDER BY position ASC, created_at DESC
    `).bind(...bindValues).all();

    const todosWithSteps = results.map((t: any) => ({
      ...t,
      completed: !!t.completed,
      trial_level: t.trial_level ?? 0,
      steps: normalizeSteps(parseSteps(t.steps))
    }));

    return c.json(todosWithSteps);
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to fetch todos for category' }, 500);
  }
});