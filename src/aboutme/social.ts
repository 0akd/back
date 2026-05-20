import { Hono } from 'hono';

// Define the Cloudflare environment bindings to match your main app
type Bindings = {
  todo_db: D1Database;
};

// Initialize the sub-router
const social = new Hono<{ Bindings: Bindings }>();

// Define the expected shape of the incoming request body
interface SocialProfileBody {
  platform_name: string;
  icon_base64: string;
  metadata: Record<string, string | number>; 
}

/**
 * GET / 
 * Fetches all profiles (You might want to exclude the heavy base64 string here now!)
 */
social.get('/', async (c) => {
  try {
    const { results } = await c.env.todo_db.prepare(
      'SELECT id, platform_name, metadata, created_at FROM social_profiles ORDER BY created_at DESC'
    ).all();

    const profiles = results.map((row) => ({
      ...row,
      metadata: JSON.parse(row.metadata as string),
    }));

    return c.json({ success: true, data: profiles });
  } catch (error) {
    return c.json({ success: false, error: 'Failed to fetch profiles' }, 500);
  }
});

/**
 * GET /:id/icon
 * Serves the Base64 string as an actual image file!
 */
social.get('/:id/icon', async (c) => {
  const id = c.req.param('id');
  
  try {
    // 1. Fetch the specific profile's base64 string
    const profile = await c.env.todo_db.prepare(
      'SELECT icon_base64 FROM social_profiles WHERE id = ?'
    ).bind(id).first<{ icon_base64: string }>();

    if (!profile || !profile.icon_base64) {
      return c.text('Image not found', 404);
    }

    // 2. Strip the "data:image/...;base64," prefix if the frontend sent it
    const matches = profile.icon_base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    let contentType = 'image/png'; // Fallback default
    let b64Data = profile.icon_base64;

    if (matches && matches.length === 3) {
      contentType = matches[1]; // e.g., 'image/jpeg'
      b64Data = matches[2];     // the raw base64 string
    }

    // 3. Convert Base64 to a binary Uint8Array (Standard for Cloudflare Workers)
    const binaryString = atob(b64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // 4. Return the raw image file with correct headers
    return c.body(bytes, 200, {
      'Content-Type': contentType,
      // Tell the browser to cache this image so it doesn't slam your DB on every reload
      'Cache-Control': 'public, max-age=31536000, immutable', 
    });

  } catch (error) {
    return c.text('Failed to load image', 500);
  }
});

/**
 * POST /
 */
social.post('/', async (c) => {
  try {
    const body = await c.req.json<SocialProfileBody>();

    if (!body.platform_name || !body.icon_base64 || !body.metadata) {
      return c.json({ success: false, error: 'Missing required fields' }, 400);
    }

    let finalBase64 = body.icon_base64.trim();

    // Auto-detect and prepend the Data URI prefix if the user pasted a raw string
    if (!finalBase64.startsWith('data:')) {
      let mimeType = 'image/png'; // Fallback default
      
      // Magic Bytes Detection
      if (finalBase64.startsWith('/9j/')) mimeType = 'image/jpeg';
      else if (finalBase64.startsWith('iVBORw0KGgo')) mimeType = 'image/png';
      else if (finalBase64.startsWith('R0lGODlh')) mimeType = 'image/gif';
      else if (finalBase64.startsWith('UklGR')) mimeType = 'image/webp';
      else if (finalBase64.startsWith('PHN2Zw')) mimeType = 'image/svg+xml';

      finalBase64 = `data:${mimeType};base64,${finalBase64}`;
    }

    const metadataString = JSON.stringify(body.metadata);

    await c.env.todo_db.prepare(
      `INSERT INTO social_profiles (platform_name, icon_base64, metadata) VALUES (?, ?, ?)`
    )
      .bind(body.platform_name, finalBase64, metadataString)
      .run();

    return c.json({ success: true, message: 'Profile added successfully!' }, 201);
  } catch (error) {
    return c.json({ success: false, error: 'Failed to insert profile' }, 500);
  }
});

/**
 * DELETE /:id
 */
social.delete('/:id', async (c) => {
  const id = c.req.param('id');
  
  try {
    await c.env.todo_db.prepare('DELETE FROM social_profiles WHERE id = ?').bind(id).run();
    return c.json({ success: true, message: 'Profile deleted' });
  } catch (error) {
    return c.json({ success: false, error: 'Failed to delete profile' }, 500);
  }
});

export { social };