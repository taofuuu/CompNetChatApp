import { startApp } from './app';

let app: Awaited<ReturnType<typeof startApp>>;
beforeEach(async () => (app = await startApp()));
afterEach(() => app.close());

test('the same Room from both sides (R5)', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');

  const aliceRoom = await alice.socket.emitWithAck('openPrivateRoom', 'Bob');
  const bobRoom = await bob.socket.emitWithAck('openPrivateRoom', 'Alice');

  expect(aliceRoom).toEqual({ ok: true, roomId: 'alice:bob', messages: [] });
  expect(bobRoom).toEqual({ ok: true, roomId: 'alice:bob', messages: [] });
  expect((aliceRoom as { roomId: string }).roomId).toBe((bobRoom as { roomId: string }).roomId);
});

test('a third User never receives or loads its Messages (R5, R7)', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  const carol = await app.connectAsUser('Carol');

  const room = await alice.socket.emitWithAck('openPrivateRoom', 'Bob');
  expect(room.ok).toBe(true);
  const roomId = (room as { roomId: string }).roomId;

  let carolReceived = false;
  carol.socket.on('message', () => {
    carolReceived = true;
  });

  const sendResult = await alice.socket.emitWithAck('sendMessage', {
    roomId,
    text: 'Secret message for Bob',
  });
  expect(sendResult).toEqual({ ok: true });

  const bobMessage = await bob.next('message');
  expect(bobMessage.text).toBe('Secret message for Bob');

  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(carolReceived).toBe(false);

  // Carol cannot load the messages of this Room
  const carolLoad = await carol.socket.emitWithAck('loadMessages', roomId);
  expect(carolLoad).toEqual({ ok: false, error: 'You are not in this Room.' });

  // Carol cannot send messages into this Room
  const carolSend = await carol.socket.emitWithAck('sendMessage', {
    roomId,
    text: 'Intruder message',
  });
  expect(carolSend).toEqual({ ok: false, error: 'You are not in this Room.' });
});

test('opening a Private Room with yourself or an offline User is refused (R5)', async () => {
  const alice = await app.connectAsUser('Alice');

  const selfResult = await alice.socket.emitWithAck('openPrivateRoom', 'Alice');
  expect(selfResult).toEqual({ ok: false, error: 'Cannot open a Private Room with yourself.' });

  const selfLowerResult = await alice.socket.emitWithAck('openPrivateRoom', 'aLICE');
  expect(selfLowerResult).toEqual({ ok: false, error: 'Cannot open a Private Room with yourself.' });

  const offlineResult = await alice.socket.emitWithAck('openPrivateRoom', 'Bob');
  expect(offlineResult).toEqual({ ok: false, error: 'Bob is offline.' });
});

test("sending to invalid Room ids like 'bob:alice' or 'alice:alice' is rejected", async () => {
  const alice = await app.connectAsUser('Alice');
  await app.connectAsUser('Bob');

  const reversed = await alice.socket.emitWithAck('sendMessage', { roomId: 'bob:alice', text: 'Hi' });
  expect(reversed).toEqual({ ok: false, error: 'You are not in this Room.' });

  const selfRoom = await alice.socket.emitWithAck('sendMessage', { roomId: 'alice:alice', text: 'Hi' });
  expect(selfRoom).toEqual({ ok: false, error: 'You are not in this Room.' });
});

test('Messages that are empty after trimming or over 1000 characters are rejected (R6)', async () => {
  const alice = await app.connectAsUser('Alice');
  await app.connectAsUser('Bob');
  const room = await alice.socket.emitWithAck('openPrivateRoom', 'Bob');
  expect(room.ok).toBe(true);
  const roomId = (room as { roomId: string }).roomId;

  const emptyResult = await alice.socket.emitWithAck('sendMessage', { roomId, text: '   ' });
  expect(emptyResult).toEqual({ ok: false, error: 'Enter a Message.' });

  const tooLongResult = await alice.socket.emitWithAck('sendMessage', { roomId, text: 'a'.repeat(1001) });
  expect(tooLongResult).toEqual({ ok: false, error: 'A Message can be at most 1000 characters.' });

  const validResult = await alice.socket.emitWithAck('sendMessage', { roomId, text: 'a'.repeat(1000) });
  expect(validResult).toEqual({ ok: true });
});

test('Messages are stamped with the server clock (R6)', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  const room = await alice.socket.emitWithAck('openPrivateRoom', 'Bob');
  expect(room.ok).toBe(true);
  const roomId = (room as { roomId: string }).roomId;

  const before = Date.now();
  await alice.socket.emitWithAck('sendMessage', { roomId, text: 'Hello Bob' });
  const message = await bob.next('message');
  const after = Date.now();

  expect(message.sender).toBe('Alice');
  expect(message.text).toBe('Hello Bob');
  expect(message.roomId).toBe(roomId);
  const timestamp = new Date(message.createdAt).getTime();
  expect(timestamp).toBeGreaterThanOrEqual(before - 1000);
  expect(timestamp).toBeLessThanOrEqual(after + 1000);
});

test('new Messages appear immediately on every Client of both Users (R6)', async () => {
  const aliceClient1 = await app.connectAsUser('Alice');
  const aliceClient2 = await app.connectAsUser('Alice');
  const bobClient1 = await app.connectAsUser('Bob');
  const bobClient2 = await app.connectAsUser('Bob');

  const room = await aliceClient1.socket.emitWithAck('openPrivateRoom', 'Bob');
  expect(room.ok).toBe(true);
  const roomId = (room as { roomId: string }).roomId;

  await aliceClient1.socket.emitWithAck('sendMessage', { roomId, text: 'Broadcasting test' });

  const [msgAlice1, msgAlice2, msgBob1, msgBob2] = await Promise.all([
    aliceClient1.next('message'),
    aliceClient2.next('message'),
    bobClient1.next('message'),
    bobClient2.next('message'),
  ]);

  expect(msgAlice1.text).toBe('Broadcasting test');
  expect(msgAlice2.text).toBe('Broadcasting test');
  expect(msgBob1.text).toBe('Broadcasting test');
  expect(msgBob2.text).toBe('Broadcasting test');
});

test('history survives an app restart on the same database, including Messages sent while offline (R7)', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  const room = await alice.socket.emitWithAck('openPrivateRoom', 'Bob');
  expect(room.ok).toBe(true);
  const roomId = (room as { roomId: string }).roomId;

  await alice.socket.emitWithAck('sendMessage', { roomId, text: 'Message 1' });
  await bob.socket.emitWithAck('sendMessage', { roomId, text: 'Message 2' });

  // Bob disconnects (goes offline)
  bob.socket.disconnect();

  // Alice sends message after Bob went offline
  const offlineSend = await alice.socket.emitWithAck('sendMessage', {
    roomId,
    text: 'Message 3 while Bob offline',
  });
  expect(offlineSend).toEqual({ ok: true });

  // Restart server against the same database
  await app.restart();

  // Reconnect both users
  await app.connectAsUser('Alice');
  const bob2 = await app.connectAsUser('Bob');

  // Bob opens room with Alice: loads full history
  const bobHistory = await bob2.socket.emitWithAck('openPrivateRoom', 'Alice');
  expect(bobHistory.ok).toBe(true);
  const historyMessages = (bobHistory as { messages: { sender: string; text: string }[] }).messages;
  expect(historyMessages.map((m) => ({ sender: m.sender, text: m.text }))).toEqual([
    { sender: 'Alice', text: 'Message 1' },
    { sender: 'Bob', text: 'Message 2' },
    { sender: 'Alice', text: 'Message 3 while Bob offline' },
  ]);
});
