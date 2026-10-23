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

/** Boots the whole app on a free port against a fresh in-memory MongoDB. */
export async function startApp() {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  const app: INestApplication = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  const url = `http://localhost:${(app.getHttpServer().address() as AddressInfo).port}`;
  const sockets: Socket[] = [];

  return {
    url,

    /**
     * Connects a Client over WebSocket as the User `username`, the way the page does.
     * Pass the same `browserId` to connect a second Client of the same User. Rejects with the server's reason.
     */
    connectAsUser(username: string, browserId: string = randomUUID()): Promise<TestClient> {
      const auth: HandshakeAuth = { username, browserId };
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

    async close() {
      sockets.forEach((socket) => socket.disconnect());
      await app.close();
      await mongo.stop();
    },
  };
}
