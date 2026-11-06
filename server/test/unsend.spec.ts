import { AiClient } from '../src/bot/ai.client';
import type { TestClient } from './app';
import { startApp } from './app';

let app: Awaited<ReturnType<typeof startApp>>;
beforeEach(async () => (app = await startApp()));
afterEach(() => app.close());

const PRIVATE_ROOM = 'alice:bob';

/** Long enough for an event the server did send to have arrived. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

/** Sends a Message as `client` and returns it as the Room received it. */
async function send(client: TestClient, roomId: string, text: string) {
  await client.socket.emitWithAck('sendMessage', { roomId, text });
  return client.next('message');
}

/** Makes the AI model answer `reply`, and returns a spy on what it was sent. */
function fakeModel(reply: string) {
  return jest.spyOn(app.app.get(AiClient), 'stream').mockImplementation(async function* () {
    yield reply;
  });
}

/** Records whether `client` receives any Unsend from now on. */
function watchForUnsends(client: TestClient) {
  const watched = { received: false };
  client.socket.on('messageUnsent', () => (watched.received = true));
  return watched;
}

test("unsending reaches every Client in the Room live, including the sender's other Clients, and no one else", async () => {
  const alice = await app.connectAsUser('Alice');
  const alice2 = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  const carol = await app.connectAsUser('Carol');
  const { id } = await send(alice, PRIVATE_ROOM, 'Oops');
  const carolWatch = watchForUnsends(carol);

  expect(await alice.socket.emitWithAck('unsendMessage', id!)).toEqual({ ok: true });

  for (const client of [alice, alice2, bob]) {
    expect(await client.next('messageUnsent')).toEqual({ roomId: PRIVATE_ROOM, id });
  }
  await settle();
  expect(carolWatch.received).toBe(false);
});

test('history shows the Message as unsent in the same place with the same time, even after a reconnect', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  const first = await send(alice, PRIVATE_ROOM, 'First');
  const oops = await send(alice, PRIVATE_ROOM, 'Oops');
  const last = await send(alice, PRIVATE_ROOM, 'Last');

  await alice.socket.emitWithAck('unsendMessage', oops.id!);

  const history = [first, { ...oops, text: '', unsent: true }, last];
  expect(await bob.socket.emitWithAck('loadMessages', PRIVATE_ROOM)).toEqual({ ok: true, roomId: PRIVATE_ROOM, messages: history });

  await app.restart();
  const aliceAgain = await app.connectAsUser('Alice');
  const bobAgain = await app.connectAsUser('Bob');
  expect(await aliceAgain.socket.emitWithAck('openPrivateRoom', 'Bob')).toEqual({ ok: true, roomId: PRIVATE_ROOM, messages: history });
  expect(await bobAgain.socket.emitWithAck('loadMessages', PRIVATE_ROOM)).toEqual({ ok: true, roomId: PRIVATE_ROOM, messages: history });
});

test('unsending in a Group reaches every Member, and a non-Member receives nothing', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  const carol = await app.connectAsUser('Carol');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await bob.socket.emitWithAck('joinGroup', 'Study');
  const { id } = await send(alice, '#study', 'Oops');
  const carolWatch = watchForUnsends(carol);

  expect(await alice.socket.emitWithAck('unsendMessage', id!)).toEqual({ ok: true });

  expect(await bob.next('messageUnsent')).toEqual({ roomId: '#study', id });
  await settle();
  expect(carolWatch.received).toBe(false);
  expect(await carol.socket.emitWithAck('loadMessages', '#study')).toEqual({ ok: false, error: 'You are not in this Room.' });
});

test('unsending is no new Message, the only thing that moves an unread count', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  const { id } = await send(alice, PRIVATE_ROOM, 'Oops');
  await bob.next('message');
  let bobReceived = false;
  bob.socket.on('message', () => (bobReceived = true));

  await alice.socket.emitWithAck('unsendMessage', id!);

  await bob.next('messageUnsent');
  await settle();
  expect(bobReceived).toBe(false);
});

test('the sender can unsend whatever case they logged in with', async () => {
  await app.connectAsUser('Alice');
  const alice = await app.connect({ mode: 'login', username: 'ALICE', password: 'secret' });
  const { id } = await send(alice, PRIVATE_ROOM, 'Oops');

  expect(await alice.socket.emitWithAck('unsendMessage', id!)).toEqual({ ok: true });
});

test('the Room is told the id it holds, even if the sender wrote it in capitals', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  const { id } = await send(alice, PRIVATE_ROOM, 'Oops');

  expect(await alice.socket.emitWithAck('unsendMessage', id!.toUpperCase())).toEqual({ ok: true });

  expect(await bob.next('messageUnsent')).toEqual({ roomId: PRIVATE_ROOM, id });
});

test('nobody but the sender can unsend: a refusal tells no one and changes nothing', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  const carol = await app.connectAsUser('Carol');
  const sent = await send(alice, PRIVATE_ROOM, 'Mine');
  const aliceWatch = watchForUnsends(alice);

  expect(await bob.socket.emitWithAck('unsendMessage', sent.id!)).toEqual({
    ok: false,
    error: 'You can only unsend your own Messages.',
  });
  expect(await carol.socket.emitWithAck('unsendMessage', sent.id!)).toEqual({
    ok: false,
    error: 'You are not in this Room.',
  });

  await settle();
  expect(aliceWatch.received).toBe(false);
  expect(await alice.socket.emitWithAck('loadMessages', PRIVATE_ROOM)).toMatchObject({ messages: [{ text: 'Mine' }] });
});

test('a sender no longer in the Group is refused until they rejoin', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await bob.socket.emitWithAck('joinGroup', 'Study');
  const { id } = await send(bob, '#study', 'Oops');
  await bob.socket.emitWithAck('leaveGroup', { name: 'Study' });

  expect(await bob.socket.emitWithAck('unsendMessage', id!)).toEqual({ ok: false, error: 'You are not in this Room.' });

  await bob.socket.emitWithAck('joinGroup', 'Study');
  expect(await bob.socket.emitWithAck('unsendMessage', id!)).toEqual({ ok: true });
});

test("bot's Messages can't be unsent, even by the User who asked", async () => {
  fakeModel('An answer');
  const alice = await app.connectAsUser('Alice');
  await send(alice, PRIVATE_ROOM, '@bot hello');
  const reply = await alice.next('message');
  expect(reply).toMatchObject({ sender: 'bot', text: 'An answer' });

  expect(await alice.socket.emitWithAck('unsendMessage', reply.id!)).toEqual({
    ok: false,
    error: 'You can only unsend your own Messages.',
  });
});

test('an unknown id is refused, and so is anything that is not an id', async () => {
  const alice = await app.connectAsUser('Alice');

  for (const id of ['0123456789abcdef01234567', 'not an id', '', { $ne: null }, null]) {
    expect(await alice.socket.emitWithAck('unsendMessage', id as string)).toEqual({ ok: false, error: 'There is no such Message.' });
  }
});

test('a Message already unsent is refused', async () => {
  const alice = await app.connectAsUser('Alice');
  const { id } = await send(alice, PRIVATE_ROOM, 'Oops');
  await alice.socket.emitWithAck('unsendMessage', id!);

  expect(await alice.socket.emitWithAck('unsendMessage', id!)).toEqual({ ok: false, error: 'This Message is already unsent.' });
});

test('two Clients unsending at once: only one succeeds', async () => {
  const alice = await app.connectAsUser('Alice');
  const alice2 = await app.connectAsUser('Alice');
  const { id } = await send(alice, PRIVATE_ROOM, 'Oops');

  const results = await Promise.all([alice, alice2].map(({ socket }) => socket.emitWithAck('unsendMessage', id!)));

  expect(results.filter(({ ok }) => ok)).toHaveLength(1);
});

test('an unsent Message never reaches the AI model, not even blank', async () => {
  const model = fakeModel('An answer');
  const alice = await app.connectAsUser('Alice');
  const { id } = await send(alice, PRIVATE_ROOM, 'Forget I said this');
  await alice.socket.emitWithAck('unsendMessage', id!);

  await send(alice, PRIVATE_ROOM, '@bot what did I say?');
  await alice.next('message');

  const conversation = model.mock.calls[0][0].filter(({ role }) => role !== 'system');
  expect(conversation).toEqual([{ role: 'user', content: 'Alice: @bot what did I say?' }]);
});

test("bot's reply to an unsent @bot question stays", async () => {
  fakeModel('An answer');
  const alice = await app.connectAsUser('Alice');
  const question = await send(alice, PRIVATE_ROOM, '@bot hello');
  const reply = await alice.next('message');

  await alice.socket.emitWithAck('unsendMessage', question.id!);

  expect(await alice.socket.emitWithAck('loadMessages', PRIVATE_ROOM)).toMatchObject({
    messages: [{ id: question.id, text: '', unsent: true }, { id: reply.id, sender: 'bot', text: 'An answer' }],
  });
});
