// src/aboutme/todo/helpers.ts
export function parseSteps(stepsJson: string | null): any[] {
  if (!stepsJson) return [];
  try {
    const parsed = JSON.parse(stepsJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function stringifySteps(steps: any[]): string {
  return JSON.stringify(steps || []);
}

export function normalizeSteps(steps: any[] = []): any[] {
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

export function normalizeTrialLevel(level: any): number {
  const num = parseInt(String(level), 10);
  if (isNaN(num)) return 0;
  return Math.max(0, num);
}

export function buildCategoryTree(categories: any[]): any[] {
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

export async function getDescendantCategoryIds(db: D1Database, catId: number): Promise<number[]> {
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

// ... (keep all the other helper functions exactly as they are)

export function generatePromptTree(categories: any[], todos: any[]): string {
  const todosByCat = new Map<number | null, any[]>();
  todosByCat.set(null, []); 
  
  todos.forEach(t => {
    const cid = t.category_id ?? null;
    if (!todosByCat.has(cid)) todosByCat.set(cid, []);
    todosByCat.get(cid)!.push(t);
  });

  const catTree = buildCategoryTree(categories);
  let textOutput = "";

  function traverse(nodes: any[], path: string) {
    for (const cat of nodes) {
      const currentPath = path ? `${path}-/${cat.name}` : `/${cat.name}`;
      const catDesc = cat.description ? ` | Folder Description: ${cat.description}` : '';
      
      textOutput += `[FOLDER] ${currentPath}/ ${catDesc}\n`;

      const catTodos = todosByCat.get(cat.id) || [];
      for (const t of catTodos) {
         const status = t.completed ? 'Finished' : 'Not Finished';
         const tDesc = t.description ? ` | Description: ${t.description}` : '';
         const isTimer = t.lap_duration != null && t.lap_duration > 0;
         const isLapCounter = t.lap_count_target != null && t.lap_count_target > 0;
         const isTick = !isTimer && !isLapCounter && t.target_value == 1;
         
         const typeLabel = isTick ? 'tick' : isTimer ? 'timer' : isLapCounter ? 'lap-counter' : 'counter';
         textOutput += `[TODO LEAF] ${currentPath}-/${t.title}/ | Status: [${status}] | Type: ${typeLabel}${tDesc}\n`;
      }

      if (cat.children && cat.children.length > 0) {
        traverse(cat.children, currentPath);
      }
    }
  }

  traverse(catTree, "");

  const rootTodos = todosByCat.get(null) || [];
  if (rootTodos.length > 0) {
    textOutput += `[FOLDER] /Uncategorized/\n`;
    for (const t of rootTodos) {
       const status = t.completed ? 'Finished' : 'Not Finished';
       const tDesc = t.description ? ` | Description: ${t.description}` : '';
       const isTimer = t.lap_duration != null && t.lap_duration > 0;
       const isLapCounter = t.lap_count_target != null && t.lap_count_target > 0;
       const isTick = !isTimer && !isLapCounter && t.target_value == 1;
       
       const typeLabel = isTick ? 'tick' : isTimer ? 'timer' : isLapCounter ? 'lap-counter' : 'counter';
       textOutput += `[TODO LEAF] /Uncategorized/-/${t.title}/ | Status: [${status}] | Type: ${typeLabel}${tDesc}\n`;
    }
  }

  return textOutput.trim();
}