// src/aboutme/todo/stats.ts
import { Hono } from 'hono';
import { Bindings } from './types';

export const statsRouter = new Hono<{ Bindings: Bindings }>();

statsRouter.get('/stats', async (c) => {
  try {
    const { results: todos } = await c.env.todo_db.prepare(`
      SELECT completed, history_json FROM todos
    `).all();

    const totalTodos = todos.length;

    // Early return if no todos to avoid division by zero
    if (totalTodos === 0) {
      return c.json({
        success: true,
        data: {
          currentCompletionPercentage: 0,
          previousCompletionPercentage: 0
        }
      });
    }

    let currentCompleted = 0;
    let previousCompleted = 0;

    for (const t of todos as any) {
      if (t.completed) {
        currentCompleted++;
      }

      try {
        const history = t.history_json ? JSON.parse(t.history_json) : [];
        if (Array.isArray(history) && history.length > 0) {
          const lastSnapshot = history[history.length - 1];
          if (lastSnapshot && lastSnapshot.completed) {
            previousCompleted++;
          }
        }
      } catch {
        // Silently ignore parse errors for corrupt individual JSON records
      }
    }

    // Calculate percentages
    const currentCompletionPercentage = (currentCompleted / totalTodos) * 100;
    const previousCompletionPercentage = (previousCompleted / totalTodos) * 100;

    return c.json({
      success: true,
      data: {
        currentCompletionPercentage,
        previousCompletionPercentage
      }
    });

  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to calculate stats' }, 500);
  }
});