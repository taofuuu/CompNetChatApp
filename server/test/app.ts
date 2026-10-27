import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { ClientToServerEvents, HandshakeAuth, ServerToClientEvents } from '@compnet/shared';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';

type Payload<E extends keyof ServerToClientEvents> = Parameters<ServerToClientEvents[E]>[0];

/** A Client connected to the test app, which remembers every event it receives. */
export interface TestClient {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  /** The oldest `event` this Client received that no earlier `next` took, waiting for one if there is none yet. */
  next<E extends keyof ServerToClientEvents>(event: E): Promise<Payload<E>>;
}

/** Boots the whole app on a free port against a fresh in-memory MongoDB. */
export async function startApp() {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  let app: INestApplication;
  let url: string;
  let sockets: Socket[] = [];

  async function boot() {
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0);
    url = `http://localhost:${(app.getHttpServer().address() as AddressInfo).port}`;
  }

  function disconnectAll() {
    sockets.forEach((socket) => socket.disconnect());
    sockets = [];
  }

  await boot();

  return {
    get url() {
      return url;
    },

    /**
     * Connects a Client over WebSocket as the User `username`, the way the page does.
     * Pass the same `browserId` to connect a second Client of the same User. Rejects with the server's reason.
     */
    connectAsUser(username: string, browserId: string = randomUUID()): Promise<TestClient> {
      const auth: HandshakeAuth = { username, browserId };
      const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(url, {
        transports: ['websocket'],
        auth,
        forceNew: true,
        reconnection: false,
      });
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

      // Connected once the Group list sent on connect has arrived too (left in the inbox for `next`):
      // the server reads it from the database, and a test that closed the app before then would interrupt that read.
      const hasGroupList = async () => {
        while (!inbox.some((received) => received.event === 'groupList')) {
          await new Promise<void>((wake) => waiting.push(wake));
        }
      };
      return new Promise((resolve, reject) => {
        socket.once('connect', () => void hasGroupList().then(() => resolve(client)));
        socket.once('connect_error', reject);
      });
    },

    /** Stops the app and boots a new one against the same database, the way a server restart does. */
    async restart() {
      disconnectAll();
      await app.close();
      await boot();
    },

    async close() {
      disconnectAll();
      await app.close();
      await mongo.stop();
    },
  };
}
