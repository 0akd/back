import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { setCookie, deleteCookie } from 'hono/cookie';

type Bindings = {
  todo_db: D1Database;
  JWT_SECRET: string;
};

const auth = new Hono<{ Bindings: Bindings }>();

/**
 * High-performance password hashing via Web Crypto API
 * Bypasses intensive Array allocation leaks to prevent HTTP 500 runtime timeouts
 */
async function hashPassword(password: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  
  // Robust buffer parsing loop execution
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// REGISTER ENDPOINT
auth.post('/register', async (c) => {
  try {
    // 1. Guard against missing environment variables
    if (!c.env.todo_db) {
      return c.json({ error: 'Database binding "todo_db" is missing.' }, 500);
    }

    // 2. Safe JSON body extraction defense
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Malformed JSON payload' }, 400);
    }

    const { email, password } = body;
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return c.json({ error: 'Email and password must be valid strings' }, 400);
    }

    const hashedPassword = await hashPassword(password);

    // 3. Database Execution
    await c.env.todo_db.prepare('INSERT INTO users (email, password) VALUES (?, ?)')
      .bind(email, hashedPassword)
      .run();

    return c.json({ success: true, message: 'User created successfully' }, 201);
  } catch (err: any) {
    // Check for SQLite UNIQUE constraint violation
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'Email address is already registered' }, 409);
    }
    return c.json({ error: 'Internal Server Error', details: err.message }, 500);
  }
});

// LOGIN ENDPOINT
auth.post('/login', async (c) => {
  try {
    // 1. Guard against missing infrastructure variables
    if (!c.env.todo_db) {
      return c.json({ error: 'Database binding "todo_db" is missing.' }, 500);
    }
    if (!c.env.JWT_SECRET) {
      return c.json({ error: 'Environment variable "JWT_SECRET" is missing.' }, 500);
    }

    // 2. Safe JSON body extraction defense
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Malformed JSON payload' }, 400);
    }

    const { email, password } = body;
    if (!email || !password) {
      return c.json({ error: 'Missing email or password' }, 400);
    }

    const hashedPassword = await hashPassword(password);

    // 3. Query Database
    const user = await c.env.todo_db.prepare('SELECT * FROM users WHERE email = ? AND password = ?')
      .bind(email, hashedPassword)
      .first<{ id: number; email: string }>();

    if (!user) {
      return c.json({ error: 'Invalid email or password' }, 401);
    }

    // 4. Generate Session Token
    const payload = {
      sub: user.id,
      email: user.email,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // 24-hour lifespan
    };
// Generate Session Token
    const token = await sign(payload, c.env.JWT_SECRET);
const isProd = !c.req.url.includes('localhost');
    // Keep the cookie as a backup, but add the token to the JSON response
    setCookie(c, 'auth_token', token, {
      httpOnly: true,
      secure: isProd, 
      sameSite: isProd ? 'None' : 'Lax', 
      maxAge: 60 * 60 * 24,
      path: '/',
    });

    // 🚀 FIXED: Send the token back to the browser explicitly
    return c.json({ 
      success: true, 
      token: token, // <--- ADD THIS LINE
      user: { id: user.id, email: user.email } 
    });

  } catch (err: any) {
    return c.json({ error: 'Internal Server Error', details: err.message }, 500);
  }
});

// LOGOUT ENDPOINT
auth.post('/logout', (c) => {
  try {
    deleteCookie(c, 'auth_token', {
      path: '/',
      secure: true,
      sameSite: 'Strict',
    });
    return c.json({ success: true, message: 'Logged out successfully' });
  } catch (err: any) {
    return c.json({ error: 'Internal Server Error during teardown', details: err.message }, 500);
  }
});

export { auth };