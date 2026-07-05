// src/aboutme/movies.ts
import { Hono } from 'hono';

type Bindings = {
  todo_db: D1Database;
};

export const movies = new Hono<{ Bindings: Bindings }>();

// Helper function to build the nested tree (Series -> Season -> Episode)
function buildMediaTree(items: any[]) {
  const map = new Map<number, any>();
  const roots: any[] = [];

  items.forEach((item) => {
    map.set(item.id, { ...item, children: [] });
  });

  items.forEach((item) => {
    const node = map.get(item.id)!;
    if (item.parent_id !== null && map.has(item.parent_id)) {
      map.get(item.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  // Sort children by position
  const sortChildren = (nodes: any[]) => {
    nodes.sort((a, b) => (a.position || 0) - (b.position || 0));
    nodes.forEach((n) => sortChildren(n.children));
  };
  sortChildren(roots);
  
  return roots;
}

// GET /api/movies - Returns the full hierarchical watch list
movies.get('/', async (c) => {
  try {
    const { results } = await c.env.todo_db.prepare(`
      SELECT * FROM media_tracker 
      ORDER BY COALESCE(parent_id, -1), position ASC, created_at DESC
    `).all();
    
    const tree = buildMediaTree(results);
    return c.json({ success: true, data: tree });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to fetch media tree' }, 500);
  }
});

// POST /api/movies - Add a new movie, series, season, or episode
movies.post('/', async (c) => {
  try {
    const { title, image_base64, parent_id, type, status, position } = await c.req.json();
    
    if (!title?.trim()) return c.json({ error: 'Title is required' }, 400);

    const targetType = type || 'movie'; // 'movie', 'series', 'season', 'episode'
    const targetStatus = status || 'watching'; // 'watching', 'watched'
    const targetParent = parent_id ?? null;
    const targetPos = position ?? 0;
    const imgData = image_base64 ?? null;

    const { success, meta } = await c.env.todo_db.prepare(`
      INSERT INTO media_tracker (title, image_base64, parent_id, type, status, position) 
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(title.trim(), imgData, targetParent, targetType, targetStatus, targetPos).run();

    return c.json({ success, id: meta?.last_row_id }, 201);
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to create media item' }, 500);
  }
});

// PUT /api/movies/:id - Update watch status, title, or image
movies.put('/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    const body = await c.req.json();
    
    const updates: string[] = [];
    const values: any[] = [];

    if (body.title !== undefined) { updates.push('title = ?'); values.push(body.title.trim()); }
    if (body.image_base64 !== undefined) { updates.push('image_base64 = ?'); values.push(body.image_base64); }
    if (body.parent_id !== undefined) { updates.push('parent_id = ?'); values.push(body.parent_id); }
    if (body.type !== undefined) { updates.push('type = ?'); values.push(body.type); }
    if (body.status !== undefined) { updates.push('status = ?'); values.push(body.status); }
    if (body.position !== undefined) { updates.push('position = ?'); values.push(body.position); }

    if (updates.length === 0) return c.json({ error: 'No fields provided for update' }, 400);

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const { success } = await c.env.todo_db.prepare(`
      UPDATE media_tracker SET ${updates.join(', ')} WHERE id = ?
    `).bind(...values).run();

    if (!success) return c.json({ error: 'Media item not found' }, 404);
    return c.json({ success: true, message: 'Updated successfully' });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to update media item' }, 500);
  }
});

// DELETE /api/movies/:id - Delete an item (and cascade down if configured)
movies.delete('/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    
    const { success } = await c.env.todo_db.prepare(`DELETE FROM media_tracker WHERE id = ?`).bind(id).run();
    
    if (!success) return c.json({ error: 'Media item not found' }, 404);
    return c.json({ success: true, message: 'Deleted successfully' });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to delete media item' }, 500);
  }
});