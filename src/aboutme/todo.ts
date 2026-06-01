import { Hono } from 'hono';

type Bindings = {
  todo_db: D1Database;
  JWT_SECRET: string;
};

const todo = new Hono<{ Bindings: Bindings }>();

// Groq config
const GROQ_API_KEY = 'REDACTED';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

// ==================== HELPERS ====================
function parseSteps(stepsJson: string | null): any[] {
  if (!stepsJson) return [];
  try {
    const parsed = JSON.parse(stepsJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stringifySteps(steps: any[]): string {
  return JSON.stringify(steps || []);
}

function normalizeSteps(steps: any[] = []): any[] {
  if (!Array.isArray(steps)) steps = [];
  const normalized = steps.map((s, idx) => {
    if (typeof s === 'string') {
      return { id: idx + 1, text: s, position: idx };
    }
    return {
      id: s.id ?? idx + 1,
      text: s.text ?? s,
      position: s.position ?? idx,
    };
  });
  normalized.sort((a, b) => a.position - b.position);
  return normalized.map((step, index) => ({
    ...step,
    position: index,
    id: step.id || index + 1,
  }));
}

function normalizeTrialLevel(level: any): number {
  const num = parseInt(String(level), 10);
  if (isNaN(num)) return 0;
  return Math.max(0, Math.min(3, num));
}

function buildCategoryTree(categories: any[]): any[] {
  const map = new Map<number, any>();
  const roots: any[] = [];

  categories.forEach((cat: any) => {
    map.set(cat.id, { ...cat, children: [] });
  });

  categories.forEach((cat: any) => {
    const node = map.get(cat.id)!;
    if (cat.parent_id !== null && cat.parent_id !== undefined && map.has(cat.parent_id)) {
      map.get(cat.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortChildren = (nodes: any[]) => {
    nodes.sort((a, b) => (a.position || 0) - (b.position || 0));
    nodes.forEach((n) => sortChildren(n.children));
  };
  sortChildren(roots);
  return roots;
}

async function getDescendantCategoryIds(db: D1Database, catId: number): Promise<number[]> {
  try {
    const { results } = await db.prepare(`
      WITH RECURSIVE descendants(id) AS (
        SELECT id FROM categories WHERE id = ?
        UNION ALL
        SELECT c.id FROM categories c
        INNER JOIN descendants d ON c.parent_id = d.id
      )
      SELECT DISTINCT id FROM descendants
    `).bind(catId).all();
    return results.map((r: any) => r.id);
  } catch (e: any) {
    console.error('Recursive descendant query error:', e);
    return [catId];
  }
}

// --- NEW PROMPT BUILDER HELPER ---
function generatePromptTree(categories: any[], todos: any[]): string {
  // Map todos by their category ID for quick lookup
  const todosByCat = new Map<number | null, any[]>();
  todosByCat.set(null, []); // for root level / uncategorized todos
  
  todos.forEach(t => {
    const cid = t.category_id ?? null;
    if (!todosByCat.has(cid)) todosByCat.set(cid, []);
    todosByCat.get(cid)!.push(t);
  });

  const catTree = buildCategoryTree(categories);
  let textOutput = "";

  // Recursive traversal to build the path structure
  function traverse(nodes: any[], path: string) {
    for (const cat of nodes) {
      // Create the path string (e.g., /Work/-/Meetings)
      const currentPath = path ? `${path}-/${cat.name}` : `/${cat.name}`;
      const catDesc = cat.description ? ` | Folder Description: ${cat.description}` : '';
      
      textOutput += `[FOLDER] ${currentPath}/ ${catDesc}\n`;

      // Append Todos that belong specifically to this folder
      const catTodos = todosByCat.get(cat.id) || [];
      for (const t of catTodos) {
         const status = t.completed ? 'Finished' : 'Not Finished';
         const tDesc = t.description ? ` | Description: ${t.description}` : '';
         textOutput += `[TODO LEAF] ${currentPath}-/${t.title}/ | Status: [${status}]${tDesc}\n`;
      }

      // If this category has subcategories, recurse into them
      if (cat.children && cat.children.length > 0) {
        traverse(cat.children, currentPath);
      }
    }
  }

  // 1. Process structured tree
  traverse(catTree, "");

  // 2. Process root level (uncategorized) todos
  const rootTodos = todosByCat.get(null) || [];
  if (rootTodos.length > 0) {
    textOutput += `[FOLDER] /Uncategorized/\n`;
    for (const t of rootTodos) {
       const status = t.completed ? 'Finished' : 'Not Finished';
       const tDesc = t.description ? ` | Description: ${t.description}` : '';
       textOutput += `[TODO LEAF] /Uncategorized/-/${t.title}/ | Status: [${status}]${tDesc}\n`;
    }
  }

  return textOutput.trim();
}

// ==================== ROUTES ====================

todo.get('/summary', async (c) => {
  try {
    // 1. Fetch Categories
    const { results: categoryResults } = await c.env.todo_db.prepare(`
      SELECT * FROM categories ORDER BY COALESCE(parent_id, -1), position ASC, created_at ASC
    `).all();

    // 2. Fetch Todos
    const { results: todoResults } = await c.env.todo_db.prepare(`
      SELECT * FROM todos ORDER BY position ASC, created_at DESC
    `).all();

    const indianTime = new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });

    // 3. Generate the strictly formatted hierarchy
   const treeString = generatePromptTree(categoryResults, todoResults);

    const prompt = `Right now it's ${indianTime}

Here is the user's current nested category and todo list tree:

${treeString}

Pick exactly one [TODO LEAF] to do right now based on its priority or context.

CRITICAL INSTRUCTIONS:
1. You must respond with ONLY the exact path to the chosen todo.
2. Absolutely NO conversational fluff, NO explanations, NO markdown formatting, and NO introductory text. 
3. Format the output exactly like this: /CategoryName/-/SubcategoryName/-/TodoTitle/`;

    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: GROQ_MODEL, messages: [{ role: 'user', content: prompt }] })
    });

    if (!response.ok) throw new Error(`Groq error: ${response.statusText}`);
    const data: any = await response.json();
    return c.json({ success: true, data: data.choices[0].message.content });
  } catch (err: any) {
    console.error('🔥 Summary Error:', err.message);
    return c.json({ success: false, error: err.message }, 500);
  }
});

todo.put('/reset', async (c) => {
  try {
    await c.env.todo_db.prepare(`UPDATE todos SET completed = 0, trial_level = 0`).run();
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message || 'Reset failed' }, 500);
  }
});

todo.post('/', async (c) => {
  const { title, description, position, steps = [], trial_level, category_id } = await c.req.json();
  if (position !== undefined) {
    await c.env.todo_db.prepare(`UPDATE todos SET position = position + 1 WHERE position >= ?`).bind(position).run();
  }
  const targetPosition = position ?? 0;
  const normalizedSteps = normalizeSteps(steps);
  const tl = normalizeTrialLevel(trial_level);
  const catId = category_id ?? null;
  const desc = description ?? null;

  const { success } = await c.env.todo_db.prepare(`
    INSERT INTO todos (title, description, position, steps, trial_level, category_id) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(title, desc, targetPosition, stringifySteps(normalizedSteps), tl, catId).run();
  return c.json({ success }, 201);
});

todo.get('/', async (c) => {
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
      steps: normalizeSteps(parseSteps(t.steps))
    }));
    return c.json(todosWithSteps);
  } catch (err: any) {
    return c.json({ error: err.message || 'Database query failed' }, 500);
  }
});

todo.put('/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    const { title, description, completed, position, steps, trial_level, category_id } = await c.req.json();
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

todo.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const { success } = await c.env.todo_db.prepare(`DELETE FROM todos WHERE id = ?`).bind(id).run();
  return c.json({ success });
});

// ==================== STEPS CRUD ====================
todo.get('/:todoId/steps', async (c) => {
  try {
    const todoId = parseInt(c.req.param('todoId'));
    const { results } = await c.env.todo_db.prepare(`SELECT steps FROM todos WHERE id = ?`).bind(todoId).all();
    if (results.length === 0) return c.json({ error: 'Todo not found' }, 404);
    const steps = normalizeSteps(parseSteps(results[0].steps));
    return c.json({ success: true, data: steps });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to fetch steps' }, 500);
  }
});

todo.post('/:todoId/steps', async (c) => {
  try {
    const todoId = parseInt(c.req.param('todoId'));
    const { text, position } = await c.req.json();
    if (!text?.trim()) return c.json({ error: 'text is required' }, 400);
    const { results } = await c.env.todo_db.prepare(`SELECT steps FROM todos WHERE id = ?`).bind(todoId).all();
    if (results.length === 0) return c.json({ error: 'Todo not found' }, 404);
    let currentSteps = normalizeSteps(parseSteps(results[0].steps));
    const newPosition = position ?? currentSteps.length;
    currentSteps = currentSteps.map(s => s.position >= newPosition ? { ...s, position: s.position + 1 } : s);
    const newStep = {
      id: Math.max(0, ...currentSteps.map(s => s.id)) + 1,
      text: text.trim(),
      position: newPosition,
    };
    currentSteps.push(newStep);
    const finalSteps = normalizeSteps(currentSteps);
    await c.env.todo_db.prepare(`UPDATE todos SET steps = ? WHERE id = ?`).bind(stringifySteps(finalSteps), todoId).run();
    return c.json({ success: true, data: newStep });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to create step' }, 500);
  }
});

todo.put('/:todoId/steps/:stepId', async (c) => {
  try {
    const todoId = parseInt(c.req.param('todoId'));
    const stepId = parseInt(c.req.param('stepId'));
    const { text, position } = await c.req.json();
    const { results } = await c.env.todo_db.prepare(`SELECT steps FROM todos WHERE id = ?`).bind(todoId).all();
    if (results.length === 0) return c.json({ error: 'Todo not found' }, 404);
    let currentSteps = normalizeSteps(parseSteps(results[0].steps));
    const stepIndex = currentSteps.findIndex(s => s.id === stepId);
    if (stepIndex === -1) return c.json({ error: 'Step not found' }, 404);
    const step = { ...currentSteps[stepIndex] };
    if (text !== undefined) step.text = text.trim();
    if (position !== undefined && position !== step.position) {
      const oldPos = step.position;
      step.position = position;
      currentSteps = currentSteps.map(s => {
        if (s.id === stepId) return step;
        if (position > oldPos && s.position > oldPos && s.position <= position) return { ...s, position: s.position - 1 };
        if (position < oldPos && s.position < oldPos && s.position >= position) return { ...s, position: s.position + 1 };
        return s;
      });
    } else {
      currentSteps[stepIndex] = step;
    }
    const finalSteps = normalizeSteps(currentSteps);
    await c.env.todo_db.prepare(`UPDATE todos SET steps = ? WHERE id = ?`).bind(stringifySteps(finalSteps), todoId).run();
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to update step' }, 500);
  }
});

todo.delete('/:todoId/steps/:stepId', async (c) => {
  try {
    const todoId = parseInt(c.req.param('todoId'));
    const stepId = parseInt(c.req.param('stepId'));
    const { results } = await c.env.todo_db.prepare(`SELECT steps FROM todos WHERE id = ?`).bind(todoId).all();
    if (results.length === 0) return c.json({ error: 'Todo not found' }, 404);
    let currentSteps = normalizeSteps(parseSteps(results[0].steps));
    const stepIndex = currentSteps.findIndex(s => s.id === stepId);
    if (stepIndex === -1) return c.json({ error: 'Step not found' }, 404);
    const deletedPosition = currentSteps[stepIndex].position;
    currentSteps.splice(stepIndex, 1);
    currentSteps = currentSteps.map(s => s.position > deletedPosition ? { ...s, position: s.position - 1 } : s);
    const finalSteps = normalizeSteps(currentSteps);
    await c.env.todo_db.prepare(`UPDATE todos SET steps = ? WHERE id = ?`).bind(stringifySteps(finalSteps), todoId).run();
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to delete step' }, 500);
  }
});

// ==================== CATEGORIES (Infinite Nesting & Description) ====================

todo.get('/categories', async (c) => {
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

todo.get('/categories/flat', async (c) => {
  try {
    const { results } = await c.env.todo_db.prepare(`
      SELECT * FROM categories ORDER BY COALESCE(parent_id, -1), position ASC, id ASC
    `).all();
    return c.json({ success: true, data: results });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to fetch categories' }, 500);
  }
});

todo.post('/categories', async (c) => {
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

todo.put('/categories/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    const { name, parent_id, position, description } = await c.req.json();
    const updates: string[] = [];
    const values: any[] = [];

    if (name !== undefined) { updates.push('name = ?'); values.push(name.trim()); }
    if (parent_id !== undefined) {
      // --- PREVENT CIRCULAR DEPENDENCIES ON CUT & PASTE ---
      if (parent_id !== null) {
        if (parent_id === id) return c.json({ error: 'Cannot move a folder into itself' }, 400);
        const descendants = await getDescendantCategoryIds(c.env.todo_db, id);
        if (descendants.includes(parent_id)) {
          return c.json({ error: 'Cannot move folder into its own sub-folder' }, 400);
        }
      }
      updates.push('parent_id = ?'); 
      values.push(parent_id ?? null); 
    }
    if (position !== undefined) { updates.push('position = ?'); values.push(position); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }

    if (updates.length === 0) return c.json({ error: 'No fields provided for update' }, 400);
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const { success } = await c.env.todo_db.prepare(`
      UPDATE categories SET ${updates.join(', ')} WHERE id = ?
    `).bind(...values).run();
    if (!success) return c.json({ error: 'Category not found' }, 404);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message || 'Update failed' }, 500);
  }
});

todo.delete('/categories/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    const cascade = c.req.query('cascade') === 'true';

    if (cascade) {
      const deleteCascade = async (catId: number) => {
        const { results: children } = await c.env.todo_db.prepare(`SELECT id FROM categories WHERE parent_id = ?`).bind(catId).all();
        for (const child of children) await deleteCascade(child.id);
        await c.env.todo_db.prepare(`UPDATE todos SET category_id = NULL WHERE category_id = ?`).bind(catId).run();
        await c.env.todo_db.prepare(`DELETE FROM categories WHERE id = ?`).bind(catId).run();
      };
      await deleteCascade(id);
      return c.json({ success: true, message: 'Category and all descendants deleted' });
    } else {
      const { results: children } = await c.env.todo_db.prepare(`SELECT COUNT(*) as count FROM categories WHERE parent_id = ?`).bind(id).all();
      if (children[0].count > 0) {
        return c.json({ error: 'Cannot delete: has subcategories. Use ?cascade=true' }, 400);
      }
      await c.env.todo_db.prepare(`UPDATE todos SET category_id = NULL WHERE category_id = ?`).bind(id).run();
      const { success } = await c.env.todo_db.prepare(`DELETE FROM categories WHERE id = ?`).bind(id).run();
      return c.json({ success });
    }
  } catch (err: any) {
    return c.json({ error: err.message || 'Delete failed' }, 500);
  }
});

// ==================== CATEGORY DESCRIPTION CRUD ====================

todo.get('/categories/:id/description', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    const { results } = await c.env.todo_db.prepare(`SELECT description FROM categories WHERE id = ?`).bind(id).all();
    if (results.length === 0) return c.json({ error: 'Category not found' }, 404);
    
    return c.json({ success: true, data: { description: results[0].description } });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to fetch category description' }, 500);
  }
});

todo.put('/categories/:id/description', async (c) => {
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

todo.delete('/categories/:id/description', async (c) => {
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

// ==================== TODOS BY CATEGORY ====================
todo.get('/categories/:id/todos', async (c) => {
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

// ==================== DEEP COPY SYSTEM ====================

// Endpoint to copy a single Todo
todo.post('/:id/copy', async (c) => {
  try {
    const id = parseInt(c.req.param('id'));
    const { category_id } = await c.req.json();
    
    const { results } = await c.env.todo_db.prepare(`SELECT * FROM todos WHERE id = ?`).bind(id).all();
    if (results.length === 0) return c.json({ error: 'Todo not found' }, 404);
    
    const t = results[0] as any;
    const targetCat = category_id !== undefined ? category_id : t.category_id;
    
    const { success } = await c.env.todo_db.prepare(`
      INSERT INTO todos (title, description, position, steps, trial_level, category_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(`${t.title} (Copy)`, t.description, t.position, t.steps, t.trial_level, targetCat).run();
    
    return c.json({ success });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to copy todo' }, 500);
  }
});

// Endpoint to deeply copy a Category (Folder) and its contents recursively
todo.post('/categories/:id/copy', async (c) => {
  try {
    const sourceId = parseInt(c.req.param('id'));
    const { parent_id } = await c.req.json();
    
    // Recursive cloning function
    async function copyCategoryRecursive(db: D1Database, currentCatId: number, targetParentId: number | null, isRoot: boolean) {
      // 1. Fetch source category
      const { results: cats } = await db.prepare(`SELECT * FROM categories WHERE id = ?`).bind(currentCatId).all();
      if (cats.length === 0) return;
      const cat = cats[0] as any;
      
      const newName = isRoot ? `${cat.name} (Copy)` : cat.name;
      
      // 2. Insert new category 
      const { meta } = await db.prepare(`
        INSERT INTO categories (name, description, parent_id, position)
        VALUES (?, ?, ?, ?)
      `).bind(newName, cat.description, targetParentId, cat.position).run();
      
      const newCatId = meta.last_row_id;
      
      // 3. Copy todos belonging to this category
      const { results: todos } = await db.prepare(`SELECT * FROM todos WHERE category_id = ?`).bind(currentCatId).all();
      for (const t of todos as any[]) {
        await db.prepare(`
          INSERT INTO todos (title, description, position, steps, trial_level, category_id)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(t.title, t.description, t.position, t.steps, t.trial_level, newCatId).run();
      }
      
      // 4. Recursively copy subcategories
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

export { todo };