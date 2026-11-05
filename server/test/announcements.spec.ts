import type { Socket } from 'socket.io-client';
import { AiClient } from '../src/bot/ai.client';
import type { TestClient } from './app';
import { startApp } from './app';

let app: Awaited<ReturnType<typeof startApp>>;
beforeEach(async () => (app = await startApp()));
afterEach(() => app.close());

/** Records whether `client` receives any Announcement from now on. */
function watchForAnnouncements(client: TestClient) {
  const watched = { received: false };
  client.socket.on('announcement', () => (watched.received = true));
  return watched;
}

/** Long enough for an event the server did send to have arrived. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

test('joining shows every Client of every Member, including the new Member, the Announcement live', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  await alice.socket.emitWithAck('createGroup', 'Study');
  const alice2 = await app.connectAsUser('Alice');
  const bob2 = await app.connectAsUser('Bob');

  const before = Date.now();
  await bob.socket.emitWithAck('joinGroup', 'study');

  for (const client of [alice, alice2, bob, bob2]) {
    const announcement = await client.next('announcement');
    expect(announcement).toMatchObject({ roomId: '#study', text: 'Bob joined the Group' });
    expect(Date.parse(announcement.createdAt)).toBeGreaterThanOrEqual(before);
  }
});

test('history holds Announcements among Messages in time order, even after a restart, and later Members see them', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await alice.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'First' });
  await bob.socket.emitWithAck('joinGroup', 'Study');
  await alice.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'Second' });
  const history = [{ text: 'First' }, { text: 'Bob joined the Group' }, { text: 'Second' }];

  expect(await bob.socket.emitWithAck('loadMessages', '#study')).toMatchObject({ ok: true, messages: history });

  await app.restart();
  const carol = await app.connectAsUser('Carol');
  await carol.socket.emitWithAck('joinGroup', 'Study');

  const loaded = await carol.socket.emitWithAck('loadMessages', '#study');
  expect(loaded).toMatchObject({ ok: true, messages: [...history, { text: 'Carol joined the Group' }] });
});

test('the Announcement has the name as registered, whatever case the User logged in with', async () => {
  const alice = await app.connectAsUser('Alice');
  await app.connectAsUser('Bob');
  const bob = await app.connect({ mode: 'login', username: 'BOB', password: 'secret' });
  await alice.socket.emitWithAck('createGroup', 'Study');

  await bob.socket.emitWithAck('joinGroup', 'Study');

  expect(await alice.next('announcement')).toMatchObject({ text: 'Bob joined the Group' });
});

test('a non-Member receives no Announcement, and a refused join announces nothing', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  const carol = await app.connectAsUser('Carol');
  await alice.socket.emitWithAck('createGroup', 'Study');
  const carolWatch = watchForAnnouncements(carol);

  await bob.socket.emitWithAck('joinGroup', 'Study');
  await bob.socket.emitWithAck('joinGroup', 'Study');
  await carol.socket.emitWithAck('joinGroup', 'Nowhere');

  await settle();
  expect(carolWatch.received).toBe(false);
  expect(await carol.socket.emitWithAck('loadMessages', '#study')).toEqual({ ok: false, error: 'You are not in this Room.' });
  expect(await alice.socket.emitWithAck('loadMessages', '#study')).toMatchObject({ messages: [{ text: 'Bob joined the Group' }] });
});

test('creating a Group adds no Announcement', async () => {
  const alice = await app.connectAsUser('Alice');
  const aliceWatch = watchForAnnouncements(alice);

  await alice.socket.emitWithAck('createGroup', 'Study');

  await settle();
  expect(aliceWatch.received).toBe(false);
  expect(await alice.socket.emitWithAck('loadMessages', '#study')).toEqual({ ok: true, roomId: '#study', messages: [] });
});

test('a Private Room never gets an Announcement', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await alice.socket.emitWithAck('sendMessage', { roomId: 'alice:bob', text: 'Hi' });

  await bob.socket.emitWithAck('joinGroup', 'Study');

  expect(await alice.socket.emitWithAck('openPrivateRoom', 'Bob')).toMatchObject({ messages: [{ text: 'Hi' }] });
});

test('an Announcement is no new Message, the only thing that moves an unread count', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  await alice.socket.emitWithAck('createGroup', 'Study');
  let aliceReceived = false;
  alice.socket.on('message', () => (aliceReceived = true));

  await bob.socket.emitWithAck('joinGroup', 'Study');

  await alice.next('announcement');
  await settle();
  expect(aliceReceived).toBe(false);
});

test("bot's context holds no Announcements, and they don't use up its limit of recent Messages", async () => {
  const model = jest.spyOn(app.app.get(AiClient), 'stream').mockImplementation(async function* () {
    yield 'An answer';
  });
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  const carol = await app.connectAsUser('Carol');
  await alice.socket.emitWithAck('createGroup', 'Study');
  const send = (text: string) => alice.socket.emitWithAck('sendMessage', { roomId: '#study', text });

  await send('One');
  await send('Two');
  await bob.socket.emitWithAck('joinGroup', 'Study');
  await send('Three');
  await send('Four');
  await carol.socket.emitWithAck('joinGroup', 'Study');
  await send('Five');
  await send('@bot hello');
  await bob.next('message'); // Three
  await bob.next('message'); // Four
  await bob.next('message'); // Five
  await bob.next('message'); // the @bot question
  await bob.next('message'); // bot's reply

  const conversation = model.mock.calls[0][0].filter(({ role }) => role !== 'system');
  expect(conversation.map(({ content }) => content)).toEqual([
    'Alice: One',
    'Alice: Two',
    'Alice: Three',
    'Alice: Four',
    'Alice: Five',
    'Alice: @bot hello',
  ]);
});

test('nothing a Client sends can produce or imitate an Announcement', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await bob.socket.emitWithAck('joinGroup', 'Study');
  const bobWatch = watchForAnnouncements(bob);
  const forged = { roomId: '#study', text: 'Carol joined the Group', createdAt: new Date().toISOString() };

  (alice.socket as Socket).emit('announcement', forged);
  await alice.socket.emitWithAck('sendMessage', forged);

  await settle();
  expect(bobWatch.received).toBe(false);
  // The forged text is an ordinary Message from Alice, with her name on it.
  expect(await bob.socket.emitWithAck('loadMessages', '#study')).toMatchObject({
    messages: [{ text: 'Bob joined the Group' }, { sender: 'Alice', text: 'Carol joined the Group' }],
  });
});
