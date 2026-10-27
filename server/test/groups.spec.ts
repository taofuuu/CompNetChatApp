import { startApp } from './app';

let app: Awaited<ReturnType<typeof startApp>>;
beforeEach(async () => (app = await startApp()));
afterEach(() => app.close());

test('a Client receives the Group list when it connects', async () => {
  const alice = await app.connectAsUser('Alice');
  await alice.socket.emitWithAck('createGroup', 'Study');

  const bob = await app.connectAsUser('Bob');

  expect(await bob.next('groupList')).toEqual([{ name: 'Study', members: ['Alice'] }]);
});

test("a new Group's creator is its only Member, and every Client sees it live (R8, R9)", async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  expect(await alice.next('groupList')).toEqual([]);
  expect(await bob.next('groupList')).toEqual([]);

  expect(await alice.socket.emitWithAck('createGroup', '  Study  ')).toEqual({ ok: true });

  expect(await alice.next('groupList')).toEqual([{ name: 'Study', members: ['Alice'] }]);
  expect(await bob.next('groupList')).toEqual([{ name: 'Study', members: ['Alice'] }]);
});

test('every Group is listed with its Members, oldest first, whoever created it (R9)', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await bob.socket.emitWithAck('createGroup', 'Games');

  const carol = await app.connectAsUser('Carol');

  expect(await carol.next('groupList')).toEqual([
    { name: 'Study', members: ['Alice'] },
    { name: 'Games', members: ['Bob'] },
  ]);
});

test('an empty Group name is rejected', async () => {
  const alice = await app.connectAsUser('Alice');

  expect(await alice.socket.emitWithAck('createGroup', '   ')).toEqual({ ok: false, error: 'Enter a Group name.' });
});

test('a Group name over 30 characters is rejected', async () => {
  const alice = await app.connectAsUser('Alice');

  expect(await alice.socket.emitWithAck('createGroup', 'x'.repeat(31))).toEqual({
    ok: false,
    error: 'A Group name can be at most 30 characters.',
  });
});

test('a Group name another Group already uses is rejected, ignoring case', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  await alice.socket.emitWithAck('createGroup', 'Study');

  expect(await bob.socket.emitWithAck('createGroup', 'sTUDY')).toEqual({
    ok: false,
    error: 'A Group named sTUDY already exists.',
  });
});

test('joining adds only the User who asked, and every Client sees it live (R10)', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  const carol = await app.connectAsUser('Carol');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await carol.next('groupList'); // the empty list on connect
  await carol.next('groupList'); // the create

  expect(await bob.socket.emitWithAck('joinGroup', 'study')).toEqual({ ok: true });

  expect(await carol.next('groupList')).toEqual([{ name: 'Study', members: ['Alice', 'Bob'] }]);
});

test('joining a Group you are already a Member of is rejected, ignoring case', async () => {
  const alice = await app.connectAsUser('Alice');
  await alice.socket.emitWithAck('createGroup', 'Study');

  expect(await alice.socket.emitWithAck('joinGroup', 'Study')).toEqual({
    ok: false,
    error: 'You are already a Member of this Group.',
  });
});

test('joining a Group that does not exist is rejected', async () => {
  const alice = await app.connectAsUser('Alice');

  expect(await alice.socket.emitWithAck('joinGroup', 'Nowhere')).toEqual({ ok: false, error: 'There is no such Group.' });
});

test('Groups and their Members survive a server restart, and Members stay Members while offline', async () => {
  const alice = await app.connectAsUser('Alice');
  const bob = await app.connectAsUser('Bob');
  await alice.socket.emitWithAck('createGroup', 'Study');
  await bob.socket.emitWithAck('joinGroup', 'Study');

  await app.restart();
  const carol = await app.connectAsUser('Carol');

  expect(await carol.next('groupList')).toEqual([{ name: 'Study', members: ['Alice', 'Bob'] }]);
});
