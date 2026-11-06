import { serve } from '@hono/node-server';
import { Community } from '@mcp-community/core';
import { openDatabase } from '@mcp-community/database';
import { createApp } from './app.js';
import { loadConfiguredExtensions } from './extension-loader.js';

process.umask(0o077);
const production = process.env.NODE_ENV === 'production';
const origin = process.env.APP_ORIGIN ?? 'http://localhost:3000';
if (production && !origin.startsWith('https://'))
  throw new Error('Production APP_ORIGIN must use HTTPS');
const db = openDatabase(process.env.DATABASE_PATH ?? './data/community.sqlite');
const extensions = await loadConfiguredExtensions(
  process.env.EXTENSIONS_FILE ?? './community.extensions.json',
);
const core = new Community(db, { extensions });
const app = createApp({ db, origin, production, core });
const server = serve({
  fetch: app.fetch,
  hostname: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? '3000'),
});
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  server.close(() => db.close());
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
