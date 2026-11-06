import { getModelToken } from '@nestjs/mongoose';
import type { ServerToClientEvents } from '@compnet/shared';
import type { Model } from 'mongoose';
import { AiClient } from '../src/bot/ai.client';
import { Announcement } from '../src/groups/announcement.schema';
import { GroupsService } from '../src/groups/groups.service';
import { Message } from '../src/messages/message.schema';
import type { TestClient } from './app';
import { startApp } from './app';

let app: Awaited<ReturnType<typeof startApp>>;
beforeEach(async () => (app = await startApp()));
afterEach(() => app.close());

const confirmedLeave = { name: 'Study', confirmed: true };

/** Records whether a Client receives `event` from now on. */
const watchFor = (event: keyof ServerToClientEvents) => (client: TestClient) => {
  const watched = { received: false };
  client.socket.on(event, () => (watched.received = true));
  return watched;
};

/** Long enough for an event the server did send to have arrived. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

/** How many Messages and Announcements the database holds for a Room. Read directly: a new Group wipes leftovers itself, which would hide them. */
const savedIn = (roomId: string) =>
  Promise.all(
    [Message, Announcement].map(({ name }) => app.app.get<Model<unknown>>(getModelToken(name)).countDocuments({ roomId })),
  );

test('confirming deletes the Group, its Messages and its Announcements, and every Client sees it live', async () => {
  const alice = await app.connectAsUser('Alice');
  const alice2 = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await bob.socket.emitWithAck('joinGroup', 'Study');
  await alice.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'Notes' });
  await bob.socket.emitWithAck('leaveGroup', { name: 'Study' });
  const everyClient = [alice, alice2, bob];
  for (const client of everyClient) {
    await client.next('groupList'); // the empty list on connect
    await client.next('groupList'); // the create
    await client.next('groupList'); // Bob's join
    await client.next('groupList'); // Bob's leave
  }
  expect(await savedIn('#study')).toEqual([1, 2]);

  expect(await alice.socket.emitWithAck('leaveGroup', confirmedLeave)).toEqual({ ok: true, deleted: true });

  for (const client of everyClient) expect(await client.next('groupList')).toEqual([]);
  expect(await savedIn('#study')).toEqual([0, 0]);
  const refused = { ok: false, error: 'You are not in this Room.' };
  expect(await alice.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'Gone?' })).toEqual(refused);
  expect(await alice.socket.emitWithAck('loadMessages', '#study')).toEqual(refused);
});

test('the deletion is announced to nobody', async () => {
  const alice = await app.connectAsUser('Alice');
  await alice.socket.emitWithAck('createGroup', 'Study');
  const watched = watchFor('announcement')(alice);

  await alice.socket.emitWithAck('leaveGroup', confirmedLeave);

  await settle();
  expect(watched.received).toBe(false);
  expect(await savedIn('#study')).toEqual([0, 0]);
});

test('the name is free again: a new Group with it starts empty, and the old Clients are not in it', async () => {
  const alice = await app.connectAsUser('Alice');
  const carol = await app.connectAsUser('Carol');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await alice.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'Old notes' });
  await alice.socket.emitWithAck('leaveGroup', confirmedLeave);

  expect(await carol.socket.emitWithAck('createGroup', 'STUDY')).toEqual({ ok: true });

  expect(await carol.socket.emitWithAck('loadMessages', '#study')).toEqual({ ok: true, roomId: '#study', messages: [] });
  const leaver = watchFor('message')(alice);
  await carol.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'New notes' });
  await settle();
  expect(leaver.received).toBe(false);
});

test('a double click on the prompt deletes once', async () => {
  const alice = await app.connectAsUser('Alice');
  await alice.socket.emitWithAck('createGroup', 'Study');

  const answers = await Promise.all([alice.socket.emitWithAck('leaveGroup', confirmedLeave), alice.socket.emitWithAck('leaveGroup', confirmedLeave)]);

  expect(answers).toContainEqual({ ok: true, deleted: true });
  expect(answers).toContainEqual({ ok: false, error: 'There is no such Group.' });
});

test('a confirmation from a non-Member deletes nothing', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  await alice.socket.emitWithAck('createGroup', 'Study');

  expect(await bob.socket.emitWithAck('leaveGroup', confirmedLeave)).toEqual({ ok: false, error: 'You are not a Member of this Group.' });

  expect(await alice.socket.emitWithAck('loadMessages', '#study')).toMatchObject({ ok: true });
});

test('a User who joins before the confirmation keeps the Group alive: confirming is then only a leave', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await alice.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'Keep me' });
  await alice.socket.emitWithAck('leaveGroup', { name: 'Study' }); // refused: the prompt is up
  await bob.socket.emitWithAck('joinGroup', 'Study');

  expect(await alice.socket.emitWithAck('leaveGroup', confirmedLeave)).toEqual({ ok: true });

  expect(await bob.socket.emitWithAck('loadMessages', '#study')).toMatchObject({
    messages: [{ text: 'Keep me' }, { text: 'Bob joined the Group' }, { text: 'Alice left the Group' }],
  });
});

test('a User joining after the deletion is refused', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await alice.socket.emitWithAck('leaveGroup', confirmedLeave);

  expect(await bob.socket.emitWithAck('joinGroup', 'Study')).toEqual({ ok: false, error: 'There is no such Group.' });
});

test.each([['the leave'], ['the join']])('with %s sent first, a User joining at the same moment is refused or keeps the Group alive', async (first) => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await alice.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'Keep me' });
  const leave = () => alice.socket.emitWithAck('leaveGroup', confirmedLeave);
  const join = () => bob.socket.emitWithAck('joinGroup', 'Study');

  const [left, joined] = first === 'the leave' ? await Promise.all([leave(), join()]) : (await Promise.all([join(), leave()])).reverse();

  const carol = await app.connectAsUser('Carol');
  const groups = await carol.next('groupList');
  const [messages] = await savedIn('#study');
  expect({ left, groups, messages }).toEqual(
    joined.ok
      ? { left: { ok: true }, groups: [{ name: 'Study', members: ['Bob'] }], messages: 1 }
      : { left: { ok: true, deleted: true }, groups: [], messages: 0 },
  );
});

/** Makes bot's reply stop after its first piece until the returned function is called. */
function holdBotReply() {
  let finish = () => {};
  const unfinished = new Promise<void>((resolve) => (finish = resolve));
  jest.spyOn(app.app.get(AiClient), 'stream').mockImplementation(async function* () {
    yield 'First half,';
    await unfinished;
    yield ' second half';
  });
  return finish;
}

test('a reply bot is still writing when the Group is deleted leaves no Message behind', async () => {
  const finishReply = holdBotReply();
  const alice = await app.connectAsUser('Alice');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await alice.socket.emitWithAck('sendMessage', { roomId: '#study', text: '@bot hello' });
  await alice.next('botChunk');

  await alice.socket.emitWithAck('leaveGroup', confirmedLeave);
  finishReply();

  await settle();
  expect(await savedIn('#study')).toEqual([0, 0]);
});

test('a reply bot is still writing never reaches a new Group with the name', async () => {
  const finishReply = holdBotReply();
  const alice = await app.connectAsUser('Alice');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await alice.socket.emitWithAck('sendMessage', { roomId: '#study', text: '@bot hello' });
  await alice.next('botChunk');
  await alice.socket.emitWithAck('leaveGroup', confirmedLeave);
  await alice.socket.emitWithAck('createGroup', 'Study');

  const late = [watchFor('botChunk'), watchFor('message')].map((watch) => watch(alice));
  finishReply();

  await settle();
  expect(late.map(({ received }) => received)).toEqual([false, false]);
  expect(await alice.socket.emitWithAck('loadMessages', '#study')).toEqual({ ok: true, roomId: '#study', messages: [] });
});

test('a Message being saved as the Group is deleted is refused and leaves nothing behind', async () => {
  const alice = await app.connectAsUser('Alice');
  await alice.socket.emitWithAck('createGroup', 'Study');
  // Its sender passes the check, and only then is the Group deleted, so the wipe is over before the Message is saved.
  jest.spyOn(app.app.get(GroupsService), 'isMember').mockImplementationOnce(async () => {
    await alice.socket.emitWithAck('leaveGroup', confirmedLeave);
    return true;
  });

  expect(await alice.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'Too late' })).toEqual({
    ok: false,
    error: 'You are not in this Room.',
  });

  expect(await savedIn('#study')).toEqual([0, 0]);
});

test('an @bot question caught the same way gets no reply, and none reaches a new Group with the name', async () => {
  const stream = jest.spyOn(app.app.get(AiClient), 'stream');
  const alice = await app.connectAsUser('Alice');
  await alice.socket.emitWithAck('createGroup', 'Study');
  jest.spyOn(app.app.get(GroupsService), 'isMember').mockImplementationOnce(async () => {
    await alice.socket.emitWithAck('leaveGroup', confirmedLeave);
    return true;
  });
  await alice.socket.emitWithAck('sendMessage', { roomId: '#study', text: '@bot hello' });
  await alice.socket.emitWithAck('createGroup', 'Study');

  await settle();

  expect(stream).not.toHaveBeenCalled();
  expect(await savedIn('#study')).toEqual([0, 0]);
});

test('an Announcement saved as the Group is deleted does not reach a new Group with the name', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  const carol = await app.connectAsUser('Carol');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await bob.socket.emitWithAck('joinGroup', 'Study');
  // Bob has left, and the Group is deleted before his Announcement is saved.
  const groups = app.app.get(GroupsService);
  const announce = groups.announce.bind(groups);
  jest.spyOn(groups, 'announce').mockImplementationOnce(async (roomId, text) => {
    await alice.socket.emitWithAck('leaveGroup', confirmedLeave);
    return announce(roomId, text);
  });
  await bob.socket.emitWithAck('leaveGroup', { name: 'Study' });

  await carol.socket.emitWithAck('createGroup', 'Study');

  expect(await carol.socket.emitWithAck('loadMessages', '#study')).toEqual({ ok: true, roomId: '#study', messages: [] });
});
