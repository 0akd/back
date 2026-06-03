// src/aboutme/reddit.ts
// Strongest possible direct Reddit fetching (June 2026)

import { Hono } from 'hono';
import { Bindings } from './todo/types';

export const reddit = new Hono<{ Bindings: Bindings }>();

interface MediaPost {
  id: string;
  title: string;
  author: string;
  score: number;
  num_comments: number;
  created_utc: number;
  permalink: string;
  subreddit: string;
  media_type: 'image' | 'video' | 'gallery';
  media_urls: string[];
  thumbnail_url: string | null;
  post_hint: string | null;
  url: string;
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
];

const REDDIT_DOMAINS = [
  'https://www.reddit.com',
  'https://old.reddit.com',
  'https://reddit.com',
];

function getRandomHeaders() {
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  const domain = REDDIT_DOMAINS[Math.floor(Math.random() * REDDIT_DOMAINS.length)];
  
  return {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Cache-Control': 'max-age=0',
    'Referer': domain,
  };
}

function getBestThumbnail(post: any): string | null {
  if (post.preview?.images?.[0]?.source?.url) {
    return post.preview.images[0].source.url.replace(/&amp;/g, '&');
  }
  if (post.thumbnail && !['self', 'default', 'nsfw'].includes(post.thumbnail)) {
    return post.thumbnail;
  }
  return null;
}

function extractMedia(post: any) {
  const postHint = post.post_hint;
  const isVideo = post.is_video || postHint === 'hosted:video';
  const hasGallery = post.gallery_data?.items?.length > 0;
  const url = post.url || '';

  if (hasGallery && post.media_metadata) {
    const urls: string[] = [];
    for (const item of post.gallery_data.items) {
      const meta = post.media_metadata[item.media_id];
      if (meta?.s?.u) urls.push(meta.s.u.replace(/&amp;/g, '&'));
    }
    if (urls.length) return { media_type: 'gallery' as const, media_urls: urls };
  }

  if (isVideo && post.media?.reddit_video?.fallback_url) {
    return { media_type: 'video' as const, media_urls: [post.media.reddit_video.fallback_url] };
  }

  if (postHint === 'image' || /\.(jpg|jpeg|png|gif|webp)/i.test(url)) {
    return { media_type: 'image' as const, media_urls: [url.replace(/&amp;/g, '&')] };
  }

  return null;
}

async function fetchRedditWithRetry(
  subreddit: string,
  sort: string,
  limit: number,
  after: string | null
) {
  const validSorts = ['hot', 'new', 'top', 'rising'];
  const sortType = validSorts.includes(sort) ? sort : 'new';

  let baseUrl = `${REDDIT_DOMAINS[0]}/r/${subreddit}/${sortType}.json`;
  let url = `${baseUrl}?limit=${Math.min(limit, 100)}&raw_json=1`;
  if (after) url += `&after=${after}`;

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: getRandomHeaders(),
        cf: {
          cacheTtl: sortType === 'new' ? 180 : 600,
          cacheEverything: true,
        },
      });

      if (res.ok) {
        return await res.json();
      }

      if ([403, 429, 503].includes(res.status) && attempt < 3) {
        const wait = 1200 * (attempt + 1) + Math.random() * 800;
        console.log(`Reddit ${res.status} - retrying in ${Math.round(wait)}ms`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      throw new Error(`Reddit returned ${res.status}`);
    } catch (e: any) {
      if (attempt === 3) throw e;
    }
  }
  throw new Error('All retries failed');
}

async function fetchRedditMedia(subreddit: string, sort = 'new', limit = 50, after: string | null = null) {
  const data: any = await fetchRedditWithRetry(subreddit, sort, limit, after);
  const posts: MediaPost[] = [];

  for (const child of data.data.children || []) {
    if (child.kind !== 't3') continue;
    const post = child.data;
    const media = extractMedia(post);
    if (media) {
      posts.push({
        id: post.id,
        title: post.title || '',
        author: post.author || '[deleted]',
        score: post.score || 0,
        num_comments: post.num_comments || 0,
        created_utc: post.created_utc || 0,
        permalink: `https://reddit.com${post.permalink}`,
        subreddit: post.subreddit || subreddit,
        media_type: media.media_type,
        media_urls: media.media_urls,
        thumbnail_url: getBestThumbnail(post),
        post_hint: post.post_hint || null,
        url: post.url || '',
      });
    }
  }

  return { posts, after: data.data.after };
}

// Routes
reddit.get('/r/:subreddit/media', async (c) => {
  try {
    const subreddit = c.req.param('subreddit');
    const sort = c.req.query('sort') || 'new';
    const limit = parseInt(c.req.query('limit') || '30');
    const after = c.req.query('after') || null;

    const result = await fetchRedditMedia(subreddit, sort, limit, after);
    return c.json({ success: true, data: result });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

reddit.get('/health', (c) => c.json({ success: true, service: 'reddit-media-v2' }));