import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { io } from 'socket.io-client';
import { startApp } from './app';

let app: Awaited<ReturnType<typeof startApp>>;
beforeEach(async () => (app = await startApp()));
afterEach(() => app.close());

test('a Client that registers a new User comes Online as that User', async () => {
  const alice = await app.connect({ mode: 'register', username: 'Alice', password: 'secret' });

  expect(await alice.next('onlineList')).toEqual(['Alice']);
});

test('a registered User logs in with any case of their username and shows in the Online List as first typed', async () => {
  (await app.connect({ mode: 'register', username: 'Alice', password: 'secret' })).socket.disconnect();

  const alice = await app.connect({ mode: 'login', username: 'aLICE', password: 'secret' });

  expect(await alice.next('onlineList')).toEqual(['Alice']);
});

test('registering a username already taken, ignoring case, is refused', async () => {
  await app.connect({ mode: 'register', username: 'Alice', password: 'secret' });

  await expect(app.connect({ mode: 'register', username: 'alice', password: 'other' })).rejects.toThrow('alice is already taken.');
});

test.each(['ab', 'has space', ''])('registering the username %p is refused by the name rule', async (username) => {
  await expect(app.connect({ mode: 'register', username, password: 'secret' })).rejects.toThrow(
    'A username is 3 to 20 letters, digits or underscores.',
  );
});

test('registering with an empty password is refused', async () => {
  await expect(app.connect({ mode: 'register', username: 'Alice', password: '' })).rejects.toThrow('Enter a password.');
});

test('logging in as a username nobody registered is refused', async () => {
  await expect(app.connect({ mode: 'login', username: 'Nobody', password: 'secret' })).rejects.toThrow('Wrong username or password.');
});

test('logging in with the wrong password is refused', async () => {
  await app.connect({ mode: 'register', username: 'Alice', password: 'secret' });

  await expect(app.connect({ mode: 'login', username: 'Alice', password: 'Secret' })).rejects.toThrow('Wrong username or password.');
});

test('one User can be logged in on several Clients at once and stays Online until the last one leaves', async () => {
  const aliceTab1 = await app.connect({ mode: 'register', username: 'Alice', password: 'secret' });
  const aliceTab2 = await app.connect({ mode: 'login', username: 'alice', password: 'secret' });
  const bob = await app.connect({ mode: 'register', username: 'Bob', password: 'hunter2' });
  expect(await bob.next('onlineList')).toEqual(['Alice', 'Bob']);

  aliceTab1.socket.disconnect();
  expect(await bob.next('onlineList')).toEqual(['Alice', 'Bob']);

  aliceTab2.socket.disconnect();
  expect(await bob.next('onlineList')).toEqual(['Bob']);
});

// The only test that looks inside the database: what is stored there is the rule under test.
test('a password sent in the handshake is kept only as a hash in the Users collection', async () => {
  await app.connect({ mode: 'register', username: 'Alice', password: 'secret' });

  const connection = app.app.get<Connection>(getConnectionToken());
  const stored = await connection.collection('users').find().toArray();
  expect(stored).toEqual([expect.objectContaining({ username: 'Alice', passwordHash: expect.stringMatching(/^\$2b\$10\$/) })]);
  // Nowhere in the database, not just not in Users: other collections (Groups, ...) exist alongside it.
  for (const { name } of await connection.db!.listCollections().toArray()) {
    expect(JSON.stringify(await connection.collection(name).find().toArray())).not.toContain('secret');
  }
});

test('a handshake without a mode is refused', async () => {
  await expect(app.connect({ username: 'Alice', password: 'secret' } as never)).rejects.toThrow('Choose Register or Log in.');
});

test('a handshake with no username or password is refused, not registered as "undefined"', async () => {
  const socket = io(app.url, { transports: ['websocket'], auth: { mode: 'register' }, forceNew: true, reconnection: false });
  const connecting = new Promise((resolve, reject) => {
    socket.once('connect', () => resolve('connected'));
    socket.once('connect_error', reject);
  });

  await expect(connecting).rejects.toThrow('A username is 3 to 20 letters, digits or underscores.');
  socket.disconnect();
});
