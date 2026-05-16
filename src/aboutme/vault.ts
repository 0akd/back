import { Hono } from 'hono';

type Bindings = {
  todo_db: D1Database;
  JWT_SECRET: string;
};

const vault = new Hono<{ Bindings: Bindings }>();

const GITHUB_API = 'https://api.github.com/repos/0akd/new/git/trees/main?recursive=1';
const RAW_BASE = 'https://raw.githubusercontent.com/0akd/new/main';

const GITHUB_HEADERS = {
  'Accept': 'application/vnd.github+json',
  'User-Agent': 'arjundubey-vault/1.0',
};

// GET /vault — returns file tree
vault.get('/', async (c) => {
  try {
    const res = await fetch(GITHUB_API, { headers: GITHUB_HEADERS });

    if (!res.ok) {
      const body = await res.text();
      console.error(`GitHub API error ${res.status}:`, body);
      return c.json({ error: `GitHub API error: ${res.status}`, detail: body }, 502);
    }

    const data: any = await res.json();

    if (!data.tree) {
      return c.json({ error: 'GitHub response missing tree', raw: data }, 502);
    }

    const files = data.tree
      .filter((item: any) => item.type === 'blob')
      .map((item: any) => ({ path: item.path, size: item.size }));

    return c.json({ files });
  } catch (err: any) {
    console.error('Vault fetch crashed:', err.message);
    return c.json({ error: err.message || 'Failed to fetch vault' }, 500);
  }
});

// GET /vault/raw/* — proxies and decodes file from GitHub
vault.get('/raw/*', async (c) => {
  const fullPath = c.req.path; // /vault/raw/ids/pan/file.txt
  const slug = fullPath.replace(/^\/vault\/raw\//, '').replace(/^\/raw\//, '');

  console.log('fullPath:', fullPath, 'slug:', slug);

  if (!slug || slug.startsWith('/')) {
    return c.json({ error: 'Missing file path', debug: { fullPath, slug } }, 400);
  }


  console.log('Fetching slug:', slug);

  try {
    const res = await fetch(`${RAW_BASE}/${slug}`, { headers: GITHUB_HEADERS });

    if (!res.ok) {
      return c.json({ error: `File not found: ${res.status}` }, 404);
    }

    const content = await res.text();

    if (content.startsWith('b64.')) {
      const slashIndex = content.indexOf('/');
      if (slashIndex !== -1) {
        const ext = content.slice(4, slashIndex).toLowerCase();
        const base64Data = content.slice(slashIndex + 1).trim();

        const mimeTypes: Record<string, string> = {
          png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
          svg: 'image/svg+xml', gif: 'image/gif', pdf: 'application/pdf',
          mp4: 'video/mp4', mp3: 'audio/mpeg', zip: 'application/zip',
        };

        const mimeType = mimeTypes[ext] || 'application/octet-stream';
        const originalName = slug.split('/').pop()!.replace('.txt', '');
        const filename = `${originalName}.${ext}`;

        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        return new Response(bytes, {
          status: 200,
          headers: {
            'Content-Type': mimeType,
            'Content-Disposition': `inline; filename="${filename}"`,
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }
    }

    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err: any) {
    console.error('Raw fetch crashed:', err.message);
    return c.json({ error: err.message || 'Failed to fetch file' }, 500);
  }
});

export { vault };