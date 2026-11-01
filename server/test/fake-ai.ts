import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

type Behaviour = { chunks: string[] } | { status: number } | 'silent' | { heldUntil: Promise<void>; chunks: string[] };

/** A local stand-in for Typhoon, speaking the OpenAI streaming format, so tests exercise the real AI client without the network. */
export async function startFakeAi() {
  let behaviour: Behaviour = { chunks: ['hello'] };
  /** The body of every chat request received, oldest first. */
  const requests: { model: string; messages: { role: string; content: string }[] }[] = [];

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (data: Buffer) => (body += data.toString()));
    req.on('end', async () => {
      requests.push(JSON.parse(body));
      if (behaviour === 'silent') return;
      if ('status' in behaviour) {
        res.writeHead(behaviour.status).end('{}');
        return;
      }
      if ('heldUntil' in behaviour) await behaviour.heldUntil;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const content of behaviour.chunks) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
      }
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((listening) => server.listen(0, listening));

  return {
    url: `http://localhost:${(server.address() as AddressInfo).port}`,
    requests,
    behave(next: Behaviour) {
      behaviour = next;
    },
    close() {
      server.closeAllConnections();
      server.close();
    },
  };
}
