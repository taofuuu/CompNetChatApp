import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { HandshakeAuth, ServerToClientEvents } from '@compnet/shared';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';

type Payload<E extends keyof ServerToClientEvents> = Parameters<ServerToClientEvents[E]>[0];

/** A Client connected to the test app, which remembers every event it receives. */
export interface TestClient {
  socket: Socket<ServerToClientEvents>;
  /** The oldest `event` this Client received that no earlier `next` took, waiting for one if there is none yet. */
  next<E extends keyof ServerToClientEvents>(event: E): Promise<Payload<E>>;
}

// One in-memory MongoDB per test file, started on first use: starting mongod is the slow part.
let mongo: Promise<MongoMemoryServer> | undefined;
afterAll(async () => {
  await (await mongo)?.stop();
  mongo = undefined;
});

/** Boots the whole app on a free port against a fresh, empty database. */
export async function startApp() {
  mongo ??= MongoMemoryServer.create();
  process.env.MONGODB_URI = (await mongo).getUri(`test-${randomUUID()}`);
  const app: INestApplication = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  const url = `http://localhost:${(app.getHttpServer().address() as AddressInfo).port}`;
  const sockets: Socket[] = [];
  const registered = new Set<string>();

  return {
    url,
    app,

    /** Connects a Client over WebSocket with this handshake, the way the page does. Rejects with the server's reason. */
    connect(auth: HandshakeAuth): Promise<TestClient> {
      const socket: Socket<ServerToClientEvents> = io(url, { transports: ['websocket'], auth, forceNew: true, reconnection: false });
      sockets.push(socket);

      // Recorded from the start, so events sent right after connecting aren't missed.
      const inbox: { event: string; payload: unknown }[] = [];
      const waiting: (() => void)[] = [];
      socket.onAny((event: string, payload: unknown) => {
        inbox.push({ event, payload });
        waiting.splice(0).forEach((wake) => wake());
      });
      const client: TestClient = {
        socket,
        async next(event) {
          for (;;) {
            const i = inbox.findIndex((received) => received.event === event);
            if (i >= 0) return inbox.splice(i, 1)[0].payload as never;
            await new Promise<void>((wake) => waiting.push(wake));
          }
        },
      };

      return new Promise((resolve, reject) => {
        socket.once('connect', () => resolve(client));
        socket.once('connect_error', reject);
      });
    },

    /**
     * Connects a Client as the User `username`: registers them the first time this app sees the name (ignoring case)
     * and logs in after that, so calling it again adds another Client of the same User.
     */
    connectAsUser(username: string, password = 'secret'): Promise<TestClient> {
      const mode = registered.has(username.toLowerCase()) ? 'login' : 'register';
      registered.add(username.toLowerCase());
      return this.connect({ mode, username, password });
    },

    async close() {
      sockets.forEach((socket) => socket.disconnect());
      await app.close();
    },
  };
}
