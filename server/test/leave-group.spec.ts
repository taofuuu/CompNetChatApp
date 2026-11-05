import type { ServerToClientEvents } from '@compnet/shared';
import { AiClient } from '../src/bot/ai.client';
import { GroupsService } from '../src/groups/groups.service';
import type { TestClient } from './app';
import { startApp } from './app';

let app: Awaited<ReturnType<typeof startApp>>;
beforeEach(async () => (app = await startApp()));
afterEach(() => app.close());

/** Records whether a Client receives `event` from now on. */
const watchFor = (event: keyof ServerToClientEvents) => (client: TestClient) => {
  const watched = { received: false };
  client.socket.on(event, () => (watched.received = true));
  return watched;
};

/** Long enough for an event the server did send to have arrived. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

test("leaving removes only the User who asked, and every Client sees it live, including the leaver's own", async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  const bob2 = await app.connectAsUser('Bob');
  const carol = await app.connectAsUser('Carol');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await bob.socket.emitWithAck('joinGroup', 'Study');
  const everyClient = [alice, bob, bob2, carol];
  for (const client of everyClient) {
    await client.next('groupList'); // the empty list on connect
    await client.next('groupList'); // the create
    await client.next('groupList'); // Bob's join
  }

  expect(await bob.socket.emitWithAck('leaveGroup', { name: 'study' })).toEqual({ ok: true });

  for (const client of everyClient) {
    expect(await client.next('groupList')).toEqual([{ name: 'Study', members: ['Alice'] }]);
  }
});

test("the remaining Members see the Announcement, with the name as registered, and the leaver's Clients don't", async () => {
  const alice = await app.connectAsUser('Alice');
  const alice2 = await app.connectAsUser('Alice');
  await app.connectAsUser('Bob');
  const bob = await app.connect({ mode: 'login', username: 'BOB', password: 'secret' });
  const bob2 = await app.connectAsUser('Bob');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await bob.socket.emitWithAck('joinGroup', 'Study');
  await alice.next('announcement'); // Bob joined
  await alice2.next('announcement');
  await settle();
  const leavers = [bob, bob2].map(watchFor('announcement'));

  await bob.socket.emitWithAck('leaveGroup', { name: 'Study' });

  for (const client of [alice, alice2]) {
    expect(await client.next('announcement')).toMatchObject({ roomId: '#study', text: 'Bob left the Group' });
  }
  await settle();
  expect(leavers.map(({ received }) => received)).toEqual([false, false]);
});

test("all the leaver's Clients stop receiving Messages and typing at once, and sending, loading or typing is refused", async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  const bob2 = await app.connectAsUser('Bob');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await bob.socket.emitWithAck('joinGroup', 'Study');

  await bob.socket.emitWithAck('leaveGroup', { name: 'Study' });

  const leavers = [bob, bob2].flatMap((client) => [watchFor('message')(client), watchFor('typing')(client)]);
  const aliceTyping = watchFor('typing')(alice);
  alice.socket.emit('typing', '#study');
  await alice.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'After Bob left' });
  bob2.socket.emit('typing', '#study');
  await settle();
  expect(leavers.map(({ received }) => received)).toEqual([false, false, false, false]);
  expect(aliceTyping.received).toBe(false);
  for (const client of [bob, bob2]) {
    const refused = { ok: false, error: 'You are not in this Room.' };
    expect(await client.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'Still here?' })).toEqual(refused);
    expect(await client.socket.emitWithAck('loadMessages', '#study')).toEqual(refused);
  }
});

test('a reply bot is still writing stops reaching the leaver, and the remaining Members get all of it', async () => {
  let finishReply = () => {};
  const unfinished = new Promise<void>((resolve) => (finishReply = resolve));
  jest.spyOn(app.app.get(AiClient), 'stream').mockImplementation(async function* () {
    yield 'First half,';
    await unfinished;
    yield ' second half';
  });
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  const bob2 = await app.connectAsUser('Bob');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await bob.socket.emitWithAck('joinGroup', 'Study');
  await alice.socket.emitWithAck('sendMessage', { roomId: '#study', text: '@bot hello' });
  for (const client of [alice, bob, bob2]) await client.next('botChunk');

  await bob.socket.emitWithAck('leaveGroup', { name: 'Study' });
  const leavers = [bob, bob2].flatMap((client) => [watchFor('botChunk')(client), watchFor('message')(client)]);
  finishReply();

  expect(await alice.next('botChunk')).toMatchObject({ text: ' second half' });
  await alice.next('message'); // the @bot question
  expect(await alice.next('message')).toMatchObject({ sender: 'bot', text: 'First half, second half' });
  await settle();
  expect(leavers.map(({ received }) => received)).toEqual([false, false, false, false]);
});

test('a non-Member or an unknown Group is refused, and nothing is announced', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  const carol = await app.connectAsUser('Carol');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await bob.socket.emitWithAck('joinGroup', 'Study');

  expect(await carol.socket.emitWithAck('leaveGroup', { name: 'Study' })).toEqual({ ok: false, error: 'You are not a Member of this Group.' });
  expect(await bob.socket.emitWithAck('leaveGroup', { name: 'Nowhere' })).toEqual({ ok: false, error: 'There is no such Group.' });

  expect(await alice.socket.emitWithAck('loadMessages', '#study')).toMatchObject({ messages: [{ text: 'Bob joined the Group' }] });
});

test('who leaves comes from the connection: a payload naming someone else removes nobody', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  const carol = await app.connectAsUser('Carol');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await bob.socket.emitWithAck('joinGroup', 'Study');
  const forged = { name: 'Study', username: 'Bob' };

  expect(await carol.socket.emitWithAck('leaveGroup', forged)).toEqual({ ok: false, error: 'You are not a Member of this Group.' });

  expect(await bob.socket.emitWithAck('loadMessages', '#study')).toMatchObject({ ok: true });
});

test('a double click is harmless: one leave, one Announcement', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await bob.socket.emitWithAck('joinGroup', 'Study');

  const answers = await Promise.all([bob.socket.emitWithAck('leaveGroup', { name: 'Study' }), bob.socket.emitWithAck('leaveGroup', { name: 'Study' })]);

  expect(answers).toContainEqual({ ok: true });
  expect(answers).toContainEqual({ ok: false, error: 'You are not a Member of this Group.' });
  expect(await alice.socket.emitWithAck('loadMessages', '#study')).toMatchObject({
    messages: [{ text: 'Bob joined the Group' }, { text: 'Bob left the Group' }],
  });
});

test.each([
  ['no confirmation', { name: 'Study' }],
  ['anything but true as confirmation', { name: 'Study', confirmed: 'yes' as unknown as boolean }],
])('the last Member is refused with %s, and stays a Member with nothing deleted', async (_, payload) => {
  const alice = await app.connectAsUser('Alice');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await alice.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'Still mine' });

  expect(await alice.socket.emitWithAck('leaveGroup', payload)).toEqual({
    ok: false,
    lastMember: true,
    error: 'You are the last Member of this Group: leaving deletes it for good.',
  });

  expect(await alice.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'Still here' })).toEqual({ ok: true });
  expect(await alice.socket.emitWithAck('loadMessages', '#study')).toMatchObject({
    messages: [{ text: 'Still mine' }, { text: 'Still here' }],
  });
});

test('two Members leaving at once: one leaves, and whoever ends up last is refused and asked', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await bob.socket.emitWithAck('joinGroup', 'Study');

  const answers = await Promise.all([
    alice.socket.emitWithAck('leaveGroup', { name: 'Study' }),
    bob.socket.emitWithAck('leaveGroup', { name: 'Study' }),
  ]);

  expect(answers).toContainEqual({ ok: true });
  expect(answers).toContainEqual(expect.objectContaining({ ok: false, lastMember: true }));
  const carol = await app.connectAsUser('Carol');
  const [{ members }] = await carol.next('groupList');
  expect(members).toHaveLength(1);
});

test("the leaver's past Messages stay, and rejoining shows the full history and the Group live", async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await bob.socket.emitWithAck('joinGroup', 'Study');
  await bob.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'My notes' });
  await bob.next('message'); // My notes

  await bob.socket.emitWithAck('leaveGroup', { name: 'Study' });
  await alice.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'Missed this' });

  const whileAway = [
    { text: 'Bob joined the Group' },
    { sender: 'Bob', text: 'My notes' },
    { text: 'Bob left the Group' },
    { sender: 'Alice', text: 'Missed this' },
  ];
  expect(await alice.socket.emitWithAck('loadMessages', '#study')).toMatchObject({ messages: whileAway });

  expect(await bob.socket.emitWithAck('joinGroup', 'Study')).toEqual({ ok: true });

  expect(await bob.socket.emitWithAck('loadMessages', '#study')).toMatchObject({
    ok: true,
    messages: [...whileAway, { text: 'Bob joined the Group' }],
  });
  await alice.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'Welcome back' });
  expect(await bob.next('message')).toMatchObject({ text: 'Welcome back' });
});

test("leaving survives a server restart, and the leaver's new Clients aren't in the Group", async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await bob.socket.emitWithAck('joinGroup', 'Study');
  await bob.socket.emitWithAck('leaveGroup', { name: 'Study' });

  await app.restart();
  const alice2 = await app.connectAsUser('Alice');
  const bob2 = await app.connectAsUser('Bob');
  const leaver = watchFor('message')(bob2);

  expect(await bob2.next('groupList')).toEqual([{ name: 'Study', members: ['Alice'] }]);
  await alice2.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'Only Alice now' });
  await settle();
  expect(leaver.received).toBe(false);
});

test('a Client connecting just as its User leaves does not end up in the Group', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await bob.socket.emitWithAck('joinGroup', 'Study');
  // The new Client's first read of the Group list is slow: it still has Bob in it when it comes back, after he left.
  const groups = app.app.get(GroupsService);
  const stale = await groups.list();
  let readStarted = () => {};
  const reading = new Promise<void>((resolve) => (readStarted = resolve));
  let finishRead = () => {};
  const slowRead = new Promise<void>((resolve) => (finishRead = resolve));
  jest.spyOn(groups, 'list').mockImplementationOnce(async () => {
    readStarted();
    await slowRead;
    return stale;
  });
  const connecting = app.connectAsUser('Bob');
  await reading;

  await bob.socket.emitWithAck('leaveGroup', { name: 'Study' });
  finishRead();

  const bob2 = await connecting;
  await settle();
  const leaver = watchFor('message')(bob2);
  await alice.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'Only Alice now' });
  await settle();
  expect(leaver.received).toBe(false);
});
