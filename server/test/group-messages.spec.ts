import type { TestClient } from './app';
import { startApp } from './app';

let app: Awaited<ReturnType<typeof startApp>>;
beforeEach(async () => (app = await startApp()));
afterEach(() => app.close());

/** Records whether `client` receives any Message from now on. */
function watchForMessages(client: TestClient) {
  const watched = { received: false };
  client.socket.on('message', () => (watched.received = true));
  return watched;
}

/** Long enough for a Message the server did send to have arrived. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

test('a Group Message reaches every Client of every Member, and no one else (R11)', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  const carol = await app.connectAsUser('Carol');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await bob.socket.emitWithAck('joinGroup', 'Study');
  // Alice's second Client connects after she became a Member.
  const alice2 = await app.connectAsUser('Alice');
  const carolWatch = watchForMessages(carol);

  expect(await bob.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'Hello Study' })).toEqual({ ok: true });

  for (const client of [alice, alice2, bob]) {
    expect(await client.next('message')).toMatchObject({ roomId: '#study', sender: 'Bob', text: 'Hello Study' });
  }
  await settle();
  expect(carolWatch.received).toBe(false);
});

test("joining puts every one of the new Member's Clients in the Group right away (R10, R11)", async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  const bob2 = await app.connectAsUser('Bob');
  await alice.socket.emitWithAck('createGroup', 'Study');

  await bob.socket.emitWithAck('joinGroup', 'study');
  await alice.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'Welcome, Bob' });

  expect(await bob.next('message')).toMatchObject({ roomId: '#study', text: 'Welcome, Bob' });
  expect(await bob2.next('message')).toMatchObject({ roomId: '#study', text: 'Welcome, Bob' });
});

test("a creator's other Clients are in the Group right away (R8, R11)", async () => {
  const alice = await app.connectAsUser('Alice');
  const alice2 = await app.connectAsUser('Alice');

  await alice.socket.emitWithAck('createGroup', 'Study');
  await alice.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'Notes' });

  expect(await alice2.next('message')).toMatchObject({ roomId: '#study', text: 'Notes' });
});

test('a User who is not a Member can neither send to nor load a Group (R11)', async () => {
  const alice = await app.connectAsUser('Alice');
  const carol = await app.connectAsUser('Carol');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await alice.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'Members only' });

  expect(await carol.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'Let me in' })).toEqual({
    ok: false,
    error: 'You are not in this Room.',
  });
  expect(await carol.socket.emitWithAck('loadMessages', '#study')).toEqual({
    ok: false,
    error: 'You are not in this Room.',
  });
  // Carol's refused Message was never saved.
  expect(await alice.socket.emitWithAck('loadMessages', '#study')).toMatchObject({
    ok: true,
    messages: [{ text: 'Members only' }],
  });
});

test('sending to or loading a Group that does not exist is refused', async () => {
  const alice = await app.connectAsUser('Alice');

  expect(await alice.socket.emitWithAck('sendMessage', { roomId: '#nowhere', text: 'Hi' })).toEqual({
    ok: false,
    error: 'You are not in this Room.',
  });
  expect(await alice.socket.emitWithAck('loadMessages', '#nowhere')).toEqual({
    ok: false,
    error: 'You are not in this Room.',
  });
});

test('a new Member sees every earlier Message after joining (R11)', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await alice.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'First' });
  await alice.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'Second' });

  await bob.socket.emitWithAck('joinGroup', 'Study');

  expect(await bob.socket.emitWithAck('loadMessages', '#study')).toMatchObject({
    ok: true,
    roomId: '#study',
    messages: [
      { sender: 'Alice', text: 'First' },
      { sender: 'Alice', text: 'Second' },
      { text: 'Bob joined the Group' },
    ],
  });
});

test('Group Messages follow the same rules as Private ones: 1–1000 characters, server time', async () => {
  const alice = await app.connectAsUser('Alice');
  await alice.socket.emitWithAck('createGroup', 'Study');

  expect(await alice.socket.emitWithAck('sendMessage', { roomId: '#study', text: '   ' })).toEqual({
    ok: false,
    error: 'Enter a Message.',
  });
  expect(await alice.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'x'.repeat(1001) })).toEqual({
    ok: false,
    error: 'A Message can be at most 1000 characters.',
  });

  const before = Date.now();
  await alice.socket.emitWithAck('sendMessage', { roomId: '#study', text: `  ${'x'.repeat(1000)}  ` });
  const message = await alice.next('message');
  expect(message.text).toBe('x'.repeat(1000));
  expect(Date.parse(message.createdAt)).toBeGreaterThanOrEqual(before);
  expect(Date.parse(message.createdAt)).toBeLessThanOrEqual(Date.now());
});
