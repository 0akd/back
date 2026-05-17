// src/aboutme/blog.ts
import { Hono } from 'hono';

const blog = new Hono();

const GITHUB_API = 'https://api.github.com/repos/0akd/blog/git/trees/main?recursive=1';
const RAW_BASE = 'https://raw.githubusercontent.com/0akd/blog/main';

const GITHUB_HEADERS = {
  'Accept': 'application/vnd.github+json',
  'User-Agent': 'arjundubey-blog/1.0',
};

// GET /api/blog -> Returns filtered list of Markdown files
blog.get('/', async (c) => {
  try {
    const res = await fetch(GITHUB_API, { headers: GITHUB_HEADERS });
    if (!res.ok) return c.json({ error: `GitHub API error: ${res.status}` }, 502);

    const data: any = await res.json();
    
    // Filter for markdown files in 'blog/'
    const mdFiles = data.tree
      .filter((file: any) => file.path.startsWith('blog/') && file.path.endsWith('.md'))
      .map((file: any) => {
        const slug = file.path.replace(/^blog\//, '').replace(/\.md$/, '');
        return { path: file.path, slug, size: file.size };
      });

    return c.json({ files: mdFiles });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to fetch blog tree' }, 500);
  }
});

// GET /api/blog/raw/* -> Returns raw markdown text for a specific post
blog.get('/raw/*', async (c) => {
  // Extract path after /raw/
  const path = c.req.path.replace(/^\/api\/blog\/raw\//, '');
  
  if (!path) return c.json({ error: 'Missing blog path' }, 400);

  try {
    const res = await fetch(`${RAW_BASE}/${path}`, { headers: GITHUB_HEADERS });
    if (!res.ok) return c.json({ error: `Blog not found: ${res.status}` }, 404);

    const content = await res.text();

    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'public, max-age=60', // Cache for 1 min to prevent rate limits while keeping it fast
      },
    });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to fetch blog content' }, 500);
  }
});

export { blog };