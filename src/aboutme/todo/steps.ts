// src/aboutme/todo/steps.ts
import { Hono } from 'hono';
import { Bindings } from './types';
import { normalizeSteps, parseSteps, stringifySteps } from './helpers';

export const stepsRouter = new Hono<{ Bindings: Bindings }>();

stepsRouter.get('/:todoId/steps', async (c) => {
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

stepsRouter.post('/:todoId/steps', async (c) => {
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

stepsRouter.put('/:todoId/steps/:stepId', async (c) => {
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

stepsRouter.delete('/:todoId/steps/:stepId', async (c) => {
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