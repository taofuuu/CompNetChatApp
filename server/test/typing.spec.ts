import type { TestClient } from './app';
import { startApp } from './app';

let app: Awaited<ReturnType<typeof startApp>>;
beforeEach(async () => (app = await startApp()));
afterEach(() => app.close());

/** Records whether `client` hears of anyone typing from now on. */
function watchForTyping(client: TestClient) {
  const watched = { received: false };
  client.socket.on('typing', () => (watched.received = true));
  return watched;
}

/** Long enough for an event the server did send to have arrived. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

test("typing in a Private Room reaches the other User's Clients, and none of the typer's own", async () => {
  const alice = await app.connectAsUser('Alice');
  const alice2 = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  const bob2 = await app.connectAsUser('Bob');
  const ownClients = [alice, alice2].map(watchForTyping);

  alice.socket.emit('typing', 'alice:bob');

  for (const client of [bob, bob2]) {
    expect(await client.next('typing')).toEqual({ roomId: 'alice:bob', username: 'Alice' });
  }
  await settle();
  expect(ownClients.map(({ received }) => received)).toEqual([false, false]);
});

test("typing in a Group reaches its other Members, and no one else", async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  const carol = await app.connectAsUser('Carol');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await bob.socket.emitWithAck('joinGroup', 'Study');
  const typer = watchForTyping(alice);
  const nonMember = watchForTyping(carol);

  alice.socket.emit('typing', '#study');

  expect(await bob.next('typing')).toEqual({ roomId: '#study', username: 'Alice' });
  await settle();
  expect(typer.received).toBe(false);
  expect(nonMember.received).toBe(false);
});

test('a User outside a Room cannot say they are typing in it', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  const carol = await app.connectAsUser('Carol');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await bob.socket.emitWithAck('joinGroup', 'Study');
  const roomUsers = [alice, bob].map(watchForTyping);

  carol.socket.emit('typing', '#study');
  carol.socket.emit('typing', 'alice:bob');

  await settle();
  expect(roomUsers.map(({ received }) => received)).toEqual([false, false]);
});

test('a Room id that is not text is ignored', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');

  alice.socket.emit('typing', 42 as never);
  alice.socket.emit('typing', undefined as never);
  alice.socket.emit('typing', 'alice:bob');

  expect(await bob.next('typing')).toEqual({ roomId: 'alice:bob', username: 'Alice' });
});
