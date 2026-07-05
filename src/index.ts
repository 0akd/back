// src/index.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors' 
import { auth } from './aboutme/auth'
import { todo } from './aboutme/todo' 
import { getCookie } from 'hono/cookie'
import { verify } from 'hono/jwt'
import { vault } from './aboutme/vault'
import { blog } from './aboutme/blog'
import { news } from './aboutme/news'
import { images } from './aboutme/images'
import { social } from './aboutme/social'
import { gpt } from './aboutme/grok'
import { book } from './aboutme/book'
import { scraper } from './aboutme/scraper'
import { reddit } from './aboutme/reddit'
import { movies } from './aboutme/movies'
import { habity } from './aboutme/habity';

type Bindings = {
  todo_db: D1Database
  JWT_SECRET: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/*', cors({
  origin: (origin) => {
    if (!origin) return 'https://who.arjundubey.com';
    return origin; 
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Set-Cookie']
}))

// Route Mounting
app.route('/api/books', book)
app.route('/api/auth', auth)
app.route('/vault', vault);
app.route('/todos', todo) 
app.route('/api/blog', blog)
app.route('/api/news', news)
app.route('/api/images', images)
app.route('/api/socials', social)
app.route('/api/gpt', gpt)
app.route('/api/scrape', scraper)
app.route('/api/movies', movies)
app.route('/api/reddit', reddit) 
app.route('/api/habity', habity);

// Auth Me Profile Route
app.get('/api/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  let token = authHeader ? authHeader.replace('Bearer ', '') : getCookie(c, 'auth_token');
  
  if (!token) {
    return c.json({ error: 'No token found' }, 401);
  }

  try {
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256');
    return c.json({ userId: payload.sub, email: payload.email });
  } catch (err) {
    return c.json({ error: 'Invalid token' }, 401);
  }
});

export default {
  fetch: app.fetch
}