// src/aboutme/todo/summary.ts
import { Hono } from 'hono';
import { Bindings } from './types';
import { generatePromptTree } from './helpers';

export const summaryRouter = new Hono<{ Bindings: Bindings }>();

const GROQ_API_KEY = 'REDACTED';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

summaryRouter.get('/summary', async (c) => {
  try {
    const { results: categoryResults } = await c.env.todo_db.prepare(`
      SELECT * FROM categories ORDER BY COALESCE(parent_id, -1), position ASC, created_at ASC
    `).all();

    const { results: todoResults } = await c.env.todo_db.prepare(`
      SELECT * FROM todos ORDER BY position ASC, created_at DESC
    `).all();

    const indianTime = new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });

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