import { Hono } from 'hono';

const blog = new Hono();

const GITHUB_API = 'https://api.github.com/repos/0akd/blog/git/trees/main?recursive=1';
const RAW_BASE = 'https://raw.githubusercontent.com/0akd/blog/main';

const GITHUB_HEADERS = {
  'Accept': 'application/vnd.github+json',
  'User-Agent': 'arjundubey-blog/1.0',
};

// Helper: Extract Title & Description from Markdown (Frontmatter or Text Fallback)
const extractMetadata = (markdown: string) => {
  let title = 'Untitled';
  let description = 'No description available.';

  // 1. Try extracting from YAML Frontmatter
  const frontmatterMatch = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const fm = frontmatterMatch[1];
    const tMatch = fm.match(/title:\s*(.*)/i);
    const dMatch = fm.match(/description:\s*([\s\S]*?)(?=\n\w|\n---$|$)/);
if (dMatch) {
  description = dMatch[1]
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/['"]/g, '')
    .trim();
}
    if (tMatch) title = tMatch[1].replace(/['"]/g, '').trim();
   
    return { title, description };
  }

  // 2. Fallback: First H1 (# Title) and First Paragraph
  const h1Match = markdown.match(/^#\s+(.*)/m);
  if (h1Match) title = h1Match[1].trim();

  const lines = markdown.split('\n').map(l => l.trim());
const pLines = lines
  .filter(l => l.length > 0 && !l.startsWith('#') && !l.startsWith('---'))
  .slice(0, 10) // grab first 10 non-heading lines
  .join(' ');

if (pLines) description = pLines;

  return { title, description };
};

// GET /api/blog/cards -> Returns array of blog cards { title, description, slug, path }
blog.get('/cards', async (c) => {
  try {
    const res = await fetch(GITHUB_API, { headers: GITHUB_HEADERS });
    if (!res.ok) return c.json({ error: `GitHub API error: ${res.status}` }, 502);

    const data: any = await res.json();
    
    const mdFiles = data.tree
      .filter((file: any) => file.path.startsWith('blog/') && file.path.endsWith('.md'))
      .map((file: any) => ({
        path: file.path,
        slug: file.path.replace(/^blog\//, '').replace(/\.md$/, ''),
      }));

    // Concurrently fetch raw content for all matched markdown files
    const cards = await Promise.all(
      mdFiles.map(async (file: { path: string; slug: string }) => {
        try {
          const rawRes = await fetch(`${RAW_BASE}/${file.path}`, { headers: GITHUB_HEADERS });
          if (!rawRes.ok) throw new Error('Fetch failed');
          const content = await rawRes.text();
          const metadata = extractMetadata(content);
          
          return { ...file, ...metadata };
        } catch {
          return { ...file, title: 'Error', description: 'Failed to parse content.' };
        }
      })
    );

    return c.json({ cards }, 200, {
      'Cache-Control': 'public, max-age=300', // Cache 5 mins to avoid hitting rate limits
    });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to generate blog cards' }, 500);
  }
});

// GET /api/blog -> Returns filtered list of Markdown files (Original)
blog.get('/', async (c) => {
  try {
    const res = await fetch(GITHUB_API, { headers: GITHUB_HEADERS });
    if (!res.ok) return c.json({ error: `GitHub API error: ${res.status}` }, 502);

    const data: any = await res.json();
    
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

// GET /api/blog/raw/* -> Returns raw markdown text for a specific post (Original)
blog.get('/raw/*', async (c) => {
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
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to fetch blog content' }, 500);
  }
});

export { blog };