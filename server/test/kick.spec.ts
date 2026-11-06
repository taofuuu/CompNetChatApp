import { getModelToken } from '@nestjs/mongoose';
import type { ServerToClientEvents } from '@compnet/shared';
import type { Model } from 'mongoose';
import { Group } from '../src/groups/group.schema';
import { OnlineListService } from '../src/online-list/online-list.service';
import type { TestClient } from './app';
import { startApp } from './app';

const TEN_MINUTES = 10 * 60_000;

let app: Awaited<ReturnType<typeof startApp>>;
beforeEach(async () => (app = await startApp()));
afterEach(() => {
  jest.useRealTimers();
  return app.close();
});

/** Stops the server's clock, and only that: sockets and the database keep running. Move it on with `jest.setSystemTime`. */
function freezeClock() {
  jest.useFakeTimers({
    doNotFake: [
      'cancelAnimationFrame',
      'cancelIdleCallback',
      'clearImmediate',
      'clearInterval',
      'clearTimeout',
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'requestIdleCallback',
      'setImmediate',
      'setInterval',
      'setTimeout',
    ],
  });
}

/** Records whether a Client receives `event` from now on. */
const watchFor = (event: keyof ServerToClientEvents) => (client: TestClient) => {
  const watched = { received: false };
  client.socket.on(event, () => (watched.received = true));
  return watched;
};

/** Long enough for an event the server did send to have arrived. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

/** Disconnects `client`, the only Client of `username`, and waits until `witness` hears they're offline. `witness` must have connected after them. */
async function goOffline(client: TestClient, username: string, witness: TestClient) {
  client.socket.disconnect();
  while ((await witness.next('onlineList')).includes(username));
}

/** The Group Study with Alice as its creator and Bob, now offline, after her. Returns Alice's Client. */
async function groupWithOfflineBob() {
  const bob = await app.connectAsUser('Bob');
  const alice = await app.connectAsUser('Alice');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await bob.socket.emitWithAck('joinGroup', 'Study');
  await goOffline(bob, 'Bob', alice);
  return alice;
}

test('kicking an offline Member who joined later removes them for every Client, announces it and keeps their past Messages', async () => {
  const bob = await app.connectAsUser('Bob');
  const alice = await app.connectAsUser('Alice');
  const carol = await app.connectAsUser('Carol');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await bob.socket.emitWithAck('joinGroup', 'Study');
  await bob.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'My notes' });
  await goOffline(bob, 'Bob', alice);
  for (const client of [alice, carol]) {
    for (let lists = 0; lists < 3; lists++) await client.next('groupList'); // the empty list on connect, the create and Bob's join
  }
  await alice.next('announcement'); // Bob joined

  expect(await alice.socket.emitWithAck('kickMember', { name: 'study', target: 'BOB' })).toEqual({ ok: true });

  for (const client of [alice, carol]) {
    expect(await client.next('groupList')).toEqual([{ name: 'Study', members: ['Alice'] }]);
  }
  expect(await alice.next('announcement')).toMatchObject({ roomId: '#study', text: 'Alice kicked Bob' });
  expect(await alice.socket.emitWithAck('loadMessages', '#study')).toMatchObject({
    messages: [{ text: 'Bob joined the Group' }, { sender: 'Bob', text: 'My notes' }, { text: 'Alice kicked Bob' }],
  });
});

describe('a kick is refused, and nothing changes,', () => {
  const offlineOnly = 'You can only kick a Member who is offline.';
  const joinedAfter = 'You can only kick Members who joined after you.';
  const notMember = 'They are not a Member of this Group.';

  test.each<[string, 'Alice' | 'Carol' | 'Dave', unknown, string]>([
    ['when the target is Online', 'Alice', { name: 'Study', target: 'Carol' }, offlineOnly],
    ['when an offline target joined before the asker', 'Carol', { name: 'Study', target: 'Bob' }, joinedAfter],
    ['when an Online target joined before the asker', 'Carol', { name: 'Study', target: 'Alice' }, joinedAfter],
    ['when the asker names themselves', 'Alice', { name: 'Study', target: 'Alice' }, joinedAfter],
    ['when the target is not a Member', 'Alice', { name: 'Study', target: 'Dave' }, notMember],
    ['when the target is nobody', 'Alice', { name: 'Study', target: 'Nobody' }, notMember],
    ['when the target is not a name', 'Alice', { name: 'Study', target: { $ne: '' } }, notMember],
    ['when the asker is not a Member', 'Dave', { name: 'Study', target: 'Bob' }, 'You are not a Member of this Group.'],
    ['when a non-Member names a Member as the asker', 'Dave', { name: 'Study', target: 'Bob', username: 'Alice' }, 'You are not a Member of this Group.'],
    ['when the Group does not exist', 'Alice', { name: 'Nowhere', target: 'Bob' }, 'There is no such Group.'],
    ['when there is no payload', 'Alice', undefined, 'There is no such Group.'],
  ])('%s', async (_, askerName, payload, error) => {
    const bob = await app.connectAsUser('Bob');
    const alice = await app.connectAsUser('Alice');
    const carol = await app.connectAsUser('Carol');
    const dave = await app.connectAsUser('Dave');
    await alice.socket.emitWithAck('createGroup', 'Study');
    await bob.socket.emitWithAck('joinGroup', 'Study');
    await carol.socket.emitWithAck('joinGroup', 'Study');
    await goOffline(bob, 'Bob', alice);
    const asker = { Alice: alice, Carol: carol, Dave: dave }[askerName];

    expect(await asker.socket.emitWithAck('kickMember', payload as never)).toEqual({ ok: false, error });

    expect(await alice.socket.emitWithAck('loadMessages', '#study')).toMatchObject({
      messages: [{ text: 'Bob joined the Group' }, { text: 'Carol joined the Group' }],
    });
    const newcomer = await app.connectAsUser('Erin');
    expect(await newcomer.next('groupList')).toEqual([{ name: 'Study', members: ['Alice', 'Bob', 'Carol'] }]);
  });
});

test('a Member who left and joined again counts from their latest join', async () => {
  const bob = await app.connectAsUser('Bob');
  const alice = await app.connectAsUser('Alice');
  const carol = await app.connectAsUser('Carol');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await bob.socket.emitWithAck('joinGroup', 'Study');
  await carol.socket.emitWithAck('joinGroup', 'Study');
  await bob.socket.emitWithAck('leaveGroup', { name: 'Study' });
  await bob.socket.emitWithAck('joinGroup', 'Study');
  await goOffline(bob, 'Bob', alice);

  expect(await carol.socket.emitWithAck('kickMember', { name: 'Study', target: 'Bob' })).toEqual({ ok: true });
});

test('a double click is harmless: one kick, one Announcement', async () => {
  const alice = await groupWithOfflineBob();
  const kick = () => alice.socket.emitWithAck('kickMember', { name: 'Study', target: 'Bob' });

  const answers = await Promise.all([kick(), kick()]);

  expect(answers).toContainEqual({ ok: true });
  expect(answers).toContainEqual({ ok: false, error: 'They are not a Member of this Group.' });
  expect(await alice.socket.emitWithAck('loadMessages', '#study')).toMatchObject({
    messages: [{ text: 'Bob joined the Group' }, { text: 'Alice kicked Bob' }],
  });
});

test('kicking and leaving at once never leaves the Group empty', async () => {
  const alice = await groupWithOfflineBob();

  await Promise.all([
    alice.socket.emitWithAck('kickMember', { name: 'Study', target: 'Bob' }),
    alice.socket.emitWithAck('leaveGroup', { name: 'Study' }),
  ]);

  const newcomer = await app.connectAsUser('Carol');
  const [{ members }] = await newcomer.next('groupList');
  expect(members).toHaveLength(1);
});

test('a Member an old Group stored in another spelling is kicked by the name it stored', async () => {
  const alice = await groupWithOfflineBob();
  await app.app.get<Model<Group>>(getModelToken(Group.name)).updateOne({ key: 'study' }, { members: ['Alice', 'BOB'] });

  expect(await alice.socket.emitWithAck('kickMember', { name: 'Study', target: 'Bob' })).toEqual({ ok: true });

  expect(await alice.socket.emitWithAck('loadMessages', '#study')).toMatchObject({
    messages: [{ text: 'Bob joined the Group' }, { text: 'Alice kicked BOB' }],
  });
  const newcomer = await app.connectAsUser('Carol');
  expect(await newcomer.next('groupList')).toEqual([{ name: 'Study', members: ['Alice'] }]);
});

test("Join is refused for 10 minutes by the server's clock, with the time left, and then works", async () => {
  const alice = await groupWithOfflineBob();
  freezeClock();
  const kickedAt = Date.now();
  await alice.socket.emitWithAck('kickMember', { name: 'Study', target: 'Bob' });
  const refusal = (timeLeft: string) => ({ ok: false, error: `You were kicked from this Group. You can join again in ${timeLeft}.` });
  /** A new Client of Bob's, `ms` after the kick. A Client in this test shares the server's clock, and one that sees it jump takes that for a lost connection. */
  const bobAfter = (ms: number) => {
    jest.setSystemTime(kickedAt + ms);
    return app.connectAsUser('Bob');
  };

  const justKicked = await bobAfter(0);
  expect(await justKicked.socket.emitWithAck('joinGroup', 'Study')).toEqual(refusal('10:00'));

  const later = await bobAfter(TEN_MINUTES - 65_000);
  expect(await later.socket.emitWithAck('joinGroup', ' STUDY ')).toEqual(refusal('1:05'));

  const almostDone = await bobAfter(TEN_MINUTES - 1);
  expect(await almostDone.socket.emitWithAck('joinGroup', 'Study')).toEqual(refusal('0:01'));

  const done = await bobAfter(TEN_MINUTES);
  expect(await done.socket.emitWithAck('joinGroup', 'Study')).toEqual({ ok: true });
  expect(await done.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'Back' })).toEqual({ ok: true });
});

test('the block is on the User, however they log in, and only on that Group', async () => {
  const alice = await groupWithOfflineBob();
  await alice.socket.emitWithAck('createGroup', 'Other');
  await alice.socket.emitWithAck('kickMember', { name: 'Study', target: 'Bob' });
  const bob = await app.connect({ mode: 'login', username: 'BOB', password: 'secret' });

  expect(await bob.socket.emitWithAck('joinGroup', 'Study')).toMatchObject({ ok: false, error: expect.stringContaining('You were kicked') });
  expect(await bob.socket.emitWithAck('joinGroup', 'Other')).toEqual({ ok: true });
});

test('the kicked User hears the time left when they log in, and no other User ever does', async () => {
  const alice = await groupWithOfflineBob();
  const carol = await app.connectAsUser('Carol');
  await carol.socket.emitWithAck('joinGroup', 'Study');
  freezeClock();
  const others = [alice, carol].map(watchFor('kickBlocks'));

  await alice.socket.emitWithAck('kickMember', { name: 'Study', target: 'Bob' });
  await settle();

  expect(others.map(({ received }) => received)).toEqual([false, false]);
  const bob = await app.connectAsUser('Bob');
  expect(await bob.next('kickBlocks')).toEqual([{ name: 'Study', msLeft: TEN_MINUTES }]);
  const dave = await app.connectAsUser('Dave');
  expect(await dave.next('kickBlocks')).toEqual([]);
  expect(await dave.next('groupList')).toEqual([{ name: 'Study', members: ['Alice', 'Carol'] }]);
});

test('a Client that connects after the block ended hears of none', async () => {
  const alice = await groupWithOfflineBob();
  freezeClock();
  const kickedAt = Date.now();
  await alice.socket.emitWithAck('kickMember', { name: 'Study', target: 'Bob' });

  jest.setSystemTime(kickedAt + TEN_MINUTES);

  const bob = await app.connectAsUser('Bob');
  expect(await bob.next('kickBlocks')).toEqual([]);
});

test('the block survives a server restart', async () => {
  const alice = await groupWithOfflineBob();
  await alice.socket.emitWithAck('kickMember', { name: 'Study', target: 'Bob' });

  await app.restart();
  const bob = await app.connectAsUser('Bob');

  expect(await bob.next('kickBlocks')).toEqual([{ name: 'Study', msLeft: expect.any(Number) }]);
  expect(await bob.socket.emitWithAck('joinGroup', 'Study')).toMatchObject({ ok: false, error: expect.stringContaining('You were kicked') });
});

test("a deleted Group's block goes with it: a new Group with the name can be joined", async () => {
  const alice = await groupWithOfflineBob();
  await alice.socket.emitWithAck('kickMember', { name: 'Study', target: 'Bob' });
  await alice.socket.emitWithAck('leaveGroup', { name: 'Study', confirmed: true });
  await alice.socket.emitWithAck('createGroup', 'Study');

  const bob = await app.connectAsUser('Bob');

  expect(await bob.next('kickBlocks')).toEqual([]);
  expect(await bob.socket.emitWithAck('joinGroup', 'Study')).toEqual({ ok: true });
});

test('a Client that connected just as its User was kicked leaves the Group and hears the block', async () => {
  const alice = await groupWithOfflineBob();
  // The kick read Bob as offline a moment before this Client of his connected.
  const bob = await app.connectAsUser('Bob');
  jest.spyOn(app.app.get(OnlineListService), 'isOnline').mockReturnValueOnce(false);

  expect(await alice.socket.emitWithAck('kickMember', { name: 'Study', target: 'Bob' })).toEqual({ ok: true });

  await bob.next('kickBlocks'); // none yet, on connect
  expect(await bob.next('kickBlocks')).toEqual([{ name: 'Study', msLeft: expect.any(Number) }]);
  const kicked = watchFor('message')(bob);
  await alice.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'Only Alice now' });
  await settle();
  expect(kicked.received).toBe(false);
});
