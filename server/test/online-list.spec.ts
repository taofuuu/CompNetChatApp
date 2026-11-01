import { io } from 'socket.io-client';
import { startApp } from './app';

let app: Awaited<ReturnType<typeof startApp>>;
beforeEach(async () => (app = await startApp()));
afterEach(() => app.close());

test('a Client sees its own User in the Online List', async () => {
  const alice = await app.connectAsUser('Alice');

  expect(await alice.next('onlineList')).toEqual(['Alice']);
});

test('every Client sees the Online List change live as Users come Online and go offline', async () => {
  const alice = await app.connectAsUser('Alice');
  expect(await alice.next('onlineList')).toEqual(['Alice']);

  const bob = await app.connectAsUser('Bob');
  expect(await alice.next('onlineList')).toEqual(['Alice', 'Bob']);
  expect(await bob.next('onlineList')).toEqual(['Alice', 'Bob']);

  bob.socket.disconnect();
  expect(await alice.next('onlineList')).toEqual(['Alice']);
});

test('a Client using HTTP long-polling instead of WebSocket is refused (ADR-0001)', async () => {
  const socket = io(app.url, {
    transports: ['polling'],
    auth: { mode: 'register', username: 'Alice', password: 'secret' },
    reconnection: false,
  });

  const connecting = new Promise((resolve, reject) => {
    socket.once('connect', () => resolve('connected'));
    socket.once('connect_error', reject);
  });

  await expect(connecting).rejects.toThrow('xhr poll error');
  socket.disconnect();
});
