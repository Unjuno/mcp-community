import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createApp } from '../apps/server/src/app.js';
import type { Fixture } from './helpers.js';

export async function listen(coreFixture: Pick<Fixture, 'core' | 'db'>) {
  let app: ReturnType<typeof createApp> | undefined;
  const server = serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => (app ? app.fetch(request) : new Response('Starting', { status: 503 })),
  });
  if (!server.listening) await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  app = createApp({ ...coreFixture, origin, production: false });
  return {
    origin,
    server,
    close: async () => {
      const closed = new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      if ('closeAllConnections' in server) server.closeAllConnections();
      await closed;
    },
  };
}
export async function connect(origin: string, token: string) {
  const client = new Client(
    { name: 'mcp-community-integration-test', version: '0.1.0' },
    {
      versionNegotiation: { mode: { pin: '2026-07-28' } },
    },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}
