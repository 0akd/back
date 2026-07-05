// src/aboutme/content.ts
import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
};

export const content = new Hono<{ Bindings: Bindings }>();

// Helper to initialize Supabase client from Cloudflare environment variables
const getSupabase = (c: any) => createClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY);

// =============================================
// POST /api/content - Create new entry
// =============================================
content.post('/', async (c) => {
  const supabase = getSupabase(c);
  const body = await c.req.json();

  if (!body.title || !body.paragraph) {
    return c.json({ error: 'title and paragraph are required' }, 400);
  }

  const { data, error } = await supabase
    .from('content')
    .insert([{ title: body.title, paragraph: body.paragraph }])
    .select();

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ success: true, data }, 201);
});

// =============================================
// GET /api/content - Read all entries
// =============================================
content.get('/', async (c) => {
  const supabase = getSupabase(c);

  const { data, error } = await supabase
    .from('content')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ success: true, data });
});

// =============================================
// GET /api/content/:id - Read single entry
// =============================================
content.get('/:id', async (c) => {
  const supabase = getSupabase(c);
  const id = c.req.param('id');

  const { data, error } = await supabase
    .from('content')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return c.json({ error: error.message }, 404);
  return c.json({ success: true, data });
});

// =============================================
// PUT /api/content/:id - Update entry
// =============================================
content.put('/:id', async (c) => {
  const supabase = getSupabase(c);
  const id = c.req.param('id');
  const body = await c.req.json();

  const updates: { title?: string; paragraph?: string } = {};
  if (body.title) updates.title = body.title;
  if (body.paragraph) updates.paragraph = body.paragraph;

  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No valid fields provided to update' }, 400);
  }

  const { data, error } = await supabase
    .from('content')
    .update(updates)
    .eq('id', id)
    .select();

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ success: true, message: 'Updated successfully', data });
});

// =============================================
// DELETE /api/content/:id - Delete entry
// =============================================
content.delete('/:id', async (c) => {
  const supabase = getSupabase(c);
  const id = c.req.param('id');

  const { error } = await supabase
    .from('content')
    .delete()
    .eq('id', id);

  if (error) return c.json({ error: error.message }, 500);
  return c.json({ success: true, message: 'Deleted successfully' });
});