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

test('an empty username is rejected', async () => {
  await expect(app.connectAsUser('   ')).rejects.toThrow('Enter a username.');
});

test('a Client without a browser id is rejected', async () => {
  await expect(app.connectAsUser('Alice', '')).rejects.toThrow('Missing browser id.');
});

test("a username an Online User already has is rejected, ignoring case", async () => {
  await app.connectAsUser('Alice');

  await expect(app.connectAsUser('aLICE')).rejects.toThrow('Alice is already Online.');
});

test('a User with two Clients stays in the Online List until the last one disconnects', async () => {
  const aliceTab1 = await app.connectAsUser('Alice', 'alice-browser');
  const aliceTab2 = await app.connectAsUser('Alice', 'alice-browser');
  const bob = await app.connectAsUser('Bob');
  expect(await bob.next('onlineList')).toEqual(['Alice', 'Bob']);

  aliceTab1.socket.disconnect();
  expect(await bob.next('onlineList')).toEqual(['Alice', 'Bob']);

  aliceTab2.socket.disconnect();
  expect(await bob.next('onlineList')).toEqual(['Bob']);
});

test('a Client using HTTP long-polling instead of WebSocket is refused (ADR-0001)', async () => {
  const socket = io(app.url, { transports: ['polling'], auth: { username: 'Alice', browserId: 'b' }, reconnection: false });

  const connecting = new Promise((resolve, reject) => {
    socket.once('connect', () => resolve('connected'));
    socket.once('connect_error', reject);
  });

  await expect(connecting).rejects.toThrow('xhr poll error');
  socket.disconnect();
});
