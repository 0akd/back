// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './migrations', // Wrangler expects migrations here by default
  dialect: 'sqlite',
  driver: 'd1-http', // Required for Cloudflare D1
});