import { Hono } from 'hono'
import { cors } from 'hono/cors' 
import { auth } from './aboutme/auth'
import { todo } from './aboutme/todo' // <--- 1. Import todo app
import { getCookie } from 'hono/cookie'
import { verify } from 'hono/jwt'
import { vault } from './aboutme/vault'
import { blog } from './aboutme/blog'

type Bindings = {
  todo_db: D1Database
  JWT_SECRET: string
}

const app = new Hono<{ Bindings: Bindings }>()

// CORS Middleware
app.use('/*', cors({
  origin: (origin) => {
    if (origin === 'https://arjundubey.com' || origin === 'http://localhost:4321') {
      return origin;
    }
    return 'http://localhost:4321';
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Set-Cookie']
}))

// Route Mounting
app.route('/api/auth', auth)
app.route('/vault', vault);
app.route('/todos', todo) // <--- 2. Mount todo app at /todos prefix
app.route('/api/blog', blog)

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

export default app