import type { ServerToClientEvents } from '@compnet/shared';
import { GroupsService } from '../src/groups/groups.service';
import type { TestClient } from './app';
import { startApp } from './app';

let app: Awaited<ReturnType<typeof startApp>>;
beforeEach(async () => (app = await startApp()));
afterEach(() => {
  jest.restoreAllMocks();
  return app.close();
});

/** The Group Study with these Users as its Members, all Online, each with one Client. */
async function groupOf(...names: string[]) {
  const clients: TestClient[] = [];
  for (const name of names) clients.push(await app.connectAsUser(name));
  await clients[0].socket.emitWithAck('createGroup', 'Study');
  for (const client of clients.slice(1)) await client.socket.emitWithAck('joinGroup', 'Study');
  return clients;
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

const voteOn = (client: TestClient, target: string) => client.socket.emitWithAck('startVoteKick', { name: 'Study', target });

test('starting a vote shows every Member who wants to kick whom, with the starter already counted', async () => {
  const [alice, bob, carol] = await groupOf('Alice', 'Bob', 'Carol');

  expect(await voteOn(alice, 'bob')).toEqual({ ok: true });

  for (const client of [alice, bob, carol]) {
    expect(await client.next('voteKick')).toEqual({
      roomId: '#study',
      starter: 'Alice',
      target: 'Bob',
      yes: 1,
      waitingFor: ['carol'],
      msLeft: expect.any(Number),
    });
  }
});

/** Casts `client`'s vote in Study. */
const cast = (client: TestClient, yes: boolean) => client.socket.emitWithAck('castVote', { name: 'Study', yes });

const noVote = { ok: false, error: 'You have no vote to cast in this Group.' };

/** The next Announcement `client` hears, passing over anyone joining. */
async function nextAnnouncement(client: TestClient) {
  for (;;) {
    const { text } = await client.next('announcement');
    if (!text.endsWith('joined the Group')) return text;
  }
}

/** Every Announcement and Message of Study so far, passing over anyone joining. */
async function history(client: TestClient) {
  const result = await client.socket.emitWithAck('loadMessages', '#study');
  return result.ok ? result.messages.map(({ text }) => text).filter((text) => !text.endsWith('joined the Group')) : result.error;
}

/** Catches the server's next 30-second timer, so a test needn't wait for it. Returns what runs the time out. */
function catchVoteTimer() {
  const realSetTimeout = global.setTimeout;
  let timeUp = () => {};
  jest.spyOn(global, 'setTimeout').mockImplementation(((callback: () => void, ms?: number, ...args: unknown[]) => {
    if (ms !== 30_000) return realSetTimeout(callback, ms, ...args);
    timeUp = callback;
    return realSetTimeout(() => {}, 0);
  }) as never);
  return () => timeUp();
}

describe('a strict majority of voters passes: the starter, plus', () => {
  test.each<[string, string[], string[], string]>([
    ['2 of 2 with 3 Online', ['Alice', 'Bob', 'Carol'], ['Carol'], 'Bob was voted out, 2 of 2 votes, started by Alice'],
    ['2 of 3 with 4 Online', ['Alice', 'Bob', 'Carol', 'Dave'], ['Carol'], 'Bob was voted out, 2 of 3 votes, started by Alice'],
    ['3 of 4 with 5 Online', ['Alice', 'Bob', 'Carol', 'Dave', 'Erin'], ['Carol', 'Dave'], 'Bob was voted out, 3 of 4 votes, started by Alice'],
  ])('%s', async (_, names, yeses, text) => {
    const clients = await groupOf(...names);
    const [alice] = clients;
    await voteOn(alice, 'Bob');

    for (const name of yeses) expect(await cast(clients[names.indexOf(name)], true)).toEqual({ ok: true });

    expect(await alice.socket.emitWithAck('loadMessages', '#study')).toMatchObject({
      messages: [...names.slice(1).map((name) => ({ text: `${name} joined the Group` })), { text }],
    });
  });
});

test('the count stays one short of passing until the last yes needed', async () => {
  const [alice, bob, carol, dave, erin] = await groupOf('Alice', 'Bob', 'Carol', 'Dave', 'Erin');
  await voteOn(alice, 'Bob');
  await alice.next('voteKick');

  await cast(carol, true);

  expect(await alice.next('voteKick')).toMatchObject({ yes: 2, waitingFor: ['dave', 'erin'] });
  expect(await alice.socket.emitWithAck('loadMessages', '#study')).toMatchObject({ messages: { length: 4 } });
  await cast(dave, true);
  expect(await bob.next('voteKickEnded')).toBe('#study');
  expect(await erin.next('voteKickEnded')).toBe('#study');
});

test('a vote that passes removes the target on all their Clients, with the 10-minute block', async () => {
  const [alice, bob, carol] = await groupOf('Alice', 'Bob', 'Carol');
  const bobAgain = await app.connectAsUser('Bob');
  await bob.socket.emitWithAck('sendMessage', { roomId: '#study', text: 'My notes' });
  await voteOn(alice, 'Bob');

  await cast(carol, true);

  for (const client of [bob, bobAgain]) {
    expect(await client.next('votedOut')).toBe('Study');
    await client.next('kickBlocks'); // none yet, on connect
    expect(await client.next('kickBlocks')).toEqual([{ name: 'Study', msLeft: expect.any(Number) }]);
  }
  expect(await bob.socket.emitWithAck('joinGroup', 'Study')).toMatchObject({ ok: false, error: expect.stringContaining('You were kicked') });
  const newcomer = await app.connectAsUser('Dave');
  expect(await newcomer.next('groupList')).toEqual([{ name: 'Study', members: ['Alice', 'Carol'] }]);
  expect(await history(alice)).toEqual(['My notes', 'Bob was voted out, 2 of 2 votes, started by Alice']);
});

test('only the target hears they were voted out', async () => {
  const [alice, , carol] = await groupOf('Alice', 'Bob', 'Carol');
  const others = [alice, carol].map(watchFor('votedOut'));
  await voteOn(alice, 'Bob');

  await cast(carol, true);
  await settle();

  expect(others.map(({ received }) => received)).toEqual([false, false]);
});

describe('a vote fails as soon as it cannot pass, and nothing else changes,', () => {
  test('on a no that leaves too few voters', async () => {
    const [alice, , carol] = await groupOf('Alice', 'Bob', 'Carol');
    await voteOn(alice, 'Bob');

    expect(await cast(carol, false)).toEqual({ ok: true });

    expect(await alice.next('voteKickEnded')).toBe('#study');
    expect(await nextAnnouncement(alice)).toBe('The vote to kick Bob failed');
    const newcomer = await app.connectAsUser('Dave');
    expect(await newcomer.next('groupList')).toEqual([{ name: 'Study', members: ['Alice', 'Bob', 'Carol'] }]);
    expect(await history(alice)).toEqual(['The vote to kick Bob failed']);
  });

  test('but not while enough voters are left', async () => {
    const [alice, , carol, dave] = await groupOf('Alice', 'Bob', 'Carol', 'Dave');
    await voteOn(alice, 'Bob');
    await alice.next('voteKick');

    await cast(carol, false);

    expect(await alice.next('voteKick')).toMatchObject({ yes: 1, waitingFor: ['dave'] });
    await cast(dave, true);
    expect(await nextAnnouncement(alice)).toBe('Bob was voted out, 2 of 3 votes, started by Alice');
  });
});

test('a new vote can start right after one fails', async () => {
  const [alice, , carol] = await groupOf('Alice', 'Bob', 'Carol');
  await voteOn(alice, 'Bob');
  await cast(carol, false);

  expect(await voteOn(alice, 'Bob')).toEqual({ ok: true });
});

describe('a vote is refused, with one answer that tells nothing about a running vote,', () => {
  test('for a second vote, even from another Client of the User', async () => {
    const [alice, , carol, dave] = await groupOf('Alice', 'Bob', 'Carol', 'Dave');
    const carolAgain = await app.connectAsUser('Carol');
    await voteOn(alice, 'Bob');
    await alice.next('voteKick');
    await cast(carol, false);

    expect(await cast(carol, true)).toEqual(noVote);
    expect(await cast(carolAgain, true)).toEqual(noVote);

    // Either refused yes would have made this vote pass.
    await cast(dave, false);
    expect(await nextAnnouncement(alice)).toBe('The vote to kick Bob failed');
  });

  test('for the starter, the target, a non-Member and a Member who came Online later', async () => {
    const [alice, bob, carol, dave] = await groupOf('Alice', 'Bob', 'Carol', 'Dave');
    const erin = await app.connectAsUser('Erin');
    await goOffline(dave, 'Dave', erin);
    await voteOn(alice, 'Bob');
    const daveLater = await app.connectAsUser('Dave');

    for (const client of [alice, bob, erin, daveLater]) expect(await cast(client, true)).toEqual(noVote);

    await cast(carol, false);
    expect(await nextAnnouncement(alice)).toBe('The vote to kick Bob failed');
  });

  test('with no vote running or no name given', async () => {
    const [alice] = await groupOf('Alice', 'Bob', 'Carol');

    expect(await cast(alice, true)).toEqual(noVote);
    expect(await alice.socket.emitWithAck('castVote', undefined as never)).toEqual(noVote);
  });
});

test('after 30 seconds silence counts as no, and the vote is over', async () => {
  const [alice, bob, carol] = await groupOf('Alice', 'Bob', 'Carol', 'Dave');
  const timeUp = catchVoteTimer();
  await voteOn(alice, 'Bob');

  timeUp();

  expect(await bob.next('voteKickEnded')).toBe('#study');
  expect(await nextAnnouncement(alice)).toBe('The vote to kick Bob failed');
  expect(await cast(carol, true)).toEqual(noVote);
});

describe('a voter who goes away without voting counts as no, at once,', () => {
  test('when their last Client disconnects', async () => {
    const [alice, , carol] = await groupOf('Alice', 'Bob', 'Carol');
    await voteOn(alice, 'Bob');

    carol.socket.disconnect();

    expect(await nextAnnouncement(alice)).toBe('The vote to kick Bob failed');
  });

  test('and coming back gives them no vote', async () => {
    const [alice, , carol, dave] = await groupOf('Alice', 'Bob', 'Carol', 'Dave');
    await voteOn(alice, 'Bob');
    await alice.next('voteKick');
    carol.socket.disconnect();
    expect(await alice.next('voteKick')).toMatchObject({ waitingFor: ['dave'] });

    const carolAgain = await app.connectAsUser('Carol');

    expect(await cast(carolAgain, true)).toEqual(noVote);
    await cast(dave, true);
    expect(await nextAnnouncement(alice)).toBe('Bob was voted out, 2 of 3 votes, started by Alice');
  });

  test('but not while another Client keeps them Online', async () => {
    const [alice, , carol] = await groupOf('Alice', 'Bob', 'Carol');
    const carolAgain = await app.connectAsUser('Carol');
    await voteOn(alice, 'Bob');

    carol.socket.disconnect();
    await carolAgain.next('onlineList');
    await settle();

    expect(await cast(carolAgain, true)).toEqual({ ok: true });
    expect(await nextAnnouncement(alice)).toBe('Bob was voted out, 2 of 2 votes, started by Alice');
  });

  test('when they leave the Group', async () => {
    const [alice, , carol] = await groupOf('Alice', 'Bob', 'Carol');
    await voteOn(alice, 'Bob');

    await carol.socket.emitWithAck('leaveGroup', { name: 'Study' });

    expect(await history(alice)).toEqual(['Carol left the Group', 'The vote to kick Bob failed']);
  });

  test('and leaving then joining again gives them no vote', async () => {
    const [alice, , carol, dave] = await groupOf('Alice', 'Bob', 'Carol', 'Dave');
    await voteOn(alice, 'Bob');
    await carol.socket.emitWithAck('leaveGroup', { name: 'Study' });
    await carol.socket.emitWithAck('joinGroup', 'Study');

    expect(await cast(carol, true)).toEqual(noVote);
    await cast(dave, false);
    expect(await nextAnnouncement(alice)).toBe('Carol left the Group');
    expect(await nextAnnouncement(alice)).toBe('The vote to kick Bob failed');
  });
});

test('the starter going away leaves their yes counted', async () => {
  const [alice, , carol, dave] = await groupOf('Alice', 'Bob', 'Carol', 'Dave');
  await voteOn(alice, 'Bob');

  await alice.socket.emitWithAck('leaveGroup', { name: 'Study' });
  await cast(carol, true);

  expect(await nextAnnouncement(dave)).toBe('Alice left the Group');
  expect(await nextAnnouncement(dave)).toBe('Bob was voted out, 2 of 3 votes, started by Alice');
});

test('the vote continues if the target goes offline, and the block waits for them', async () => {
  const [alice, bob, carol] = await groupOf('Alice', 'Bob', 'Carol');
  await voteOn(alice, 'Bob');
  const dave = await app.connectAsUser('Dave');
  await goOffline(bob, 'Bob', dave);

  await cast(carol, true);

  expect(await nextAnnouncement(alice)).toBe('Bob was voted out, 2 of 2 votes, started by Alice');
  const bobLater = await app.connectAsUser('Bob');
  expect(await bobLater.next('kickBlocks')).toEqual([{ name: 'Study', msLeft: expect.any(Number) }]);
});

describe('the vote is cancelled, with nothing about it in the Room,', () => {
  test('if the target leaves the Group', async () => {
    const [alice, bob, carol] = await groupOf('Alice', 'Bob', 'Carol');
    await voteOn(alice, 'Bob');

    await bob.socket.emitWithAck('leaveGroup', { name: 'Study' });

    expect(await carol.next('voteKickEnded')).toBe('#study');
    expect(await cast(carol, true)).toEqual(noVote);
    expect(await history(alice)).toEqual(['Bob left the Group']);
  });

  test('if the target goes offline and is then kicked', async () => {
    const [alice, bob, carol] = await groupOf('Alice', 'Bob', 'Carol');
    await voteOn(alice, 'Bob');
    const dave = await app.connectAsUser('Dave');
    await goOffline(bob, 'Bob', dave);

    await alice.socket.emitWithAck('kickMember', { name: 'Study', target: 'Bob' });

    expect(await carol.next('voteKickEnded')).toBe('#study');
    expect(await history(alice)).toEqual(['Alice kicked Bob']);
  });
});

describe('when a vote ends in the moment its target goes,', () => {
  test('one that fails just after they left adds nothing to their leaving', async () => {
    const [alice, bob, carol] = await groupOf('Alice', 'Bob', 'Carol');
    await voteOn(alice, 'Bob');
    const groups = app.app.get(GroupsService);
    const list = groups.list.bind(groups);
    // Runs after Bob is out of the Group, before the vote hears of it.
    jest.spyOn(groups, 'list').mockImplementationOnce(async () => {
      await cast(carol, false);
      return list();
    });

    await bob.socket.emitWithAck('leaveGroup', { name: 'Study' });

    expect(await history(alice)).toEqual(['Bob left the Group']);
  });

  test('one started just after a pass, while the target was still a Member, is cancelled', async () => {
    const [alice, , carol] = await groupOf('Alice', 'Bob', 'Carol');
    await voteOn(alice, 'Bob');
    const groups = app.app.get(GroupsService);
    const voteOut = groups.voteOut.bind(groups);
    // Runs after the vote passed, before Bob is out of the Group.
    jest.spyOn(groups, 'voteOut').mockImplementationOnce(async (...args) => {
      expect(await voteOn(alice, 'Bob')).toEqual({ ok: true });
      return voteOut(...args);
    });

    await cast(carol, true);

    expect(await cast(carol, false)).toEqual(noVote);
    expect(await history(alice)).toEqual(['Bob was voted out, 2 of 2 votes, started by Alice']);
  });
});

describe('reaching Members who are not looking:', () => {
  test('a Client that connects mid-vote receives it with the true time left', async () => {
    const [alice] = await groupOf('Alice', 'Bob', 'Carol', 'Dave');
    const startedAt = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(startedAt);
    await voteOn(alice, 'Bob');
    expect(await alice.next('voteKick')).toMatchObject({ msLeft: 30_000 });

    clock.mockReturnValue(startedAt + 12_000);
    const carolAgain = await app.connectAsUser('Carol');

    expect(await carolAgain.next('voteKick')).toEqual({
      roomId: '#study',
      starter: 'Alice',
      target: 'Bob',
      yes: 1,
      waitingFor: ['carol', 'dave'],
      msLeft: 18_000,
    });
  });

  test('a Client that connects after its User voted is told they can vote no more', async () => {
    const [alice, , carol] = await groupOf('Alice', 'Bob', 'Carol', 'Dave', 'Erin');
    await voteOn(alice, 'Bob');

    await cast(carol, true);

    const carolAgain = await app.connectAsUser('Carol');
    expect(await carolAgain.next('voteKick')).toMatchObject({ yes: 2, waitingFor: ['dave', 'erin'] });
  });

  test('when a User votes on one Client, their other Clients hear they can vote no more', async () => {
    const [alice, , carol] = await groupOf('Alice', 'Bob', 'Carol', 'Dave', 'Erin');
    const carolAgain = await app.connectAsUser('Carol');
    await voteOn(alice, 'Bob');
    await carolAgain.next('voteKick');

    await cast(carol, false);

    expect(await carolAgain.next('voteKick')).toMatchObject({ yes: 1, waitingFor: ['dave', 'erin'] });
  });

  test('a Member who joins mid-vote receives it on all their Clients, and cannot vote', async () => {
    const [alice] = await groupOf('Alice', 'Bob', 'Carol');
    const erin = await app.connectAsUser('Erin');
    const erinAgain = await app.connectAsUser('Erin');
    await voteOn(alice, 'Bob');

    await erin.socket.emitWithAck('joinGroup', 'Study');

    for (const client of [erin, erinAgain]) expect(await client.next('voteKick')).toMatchObject({ waitingFor: ['carol'] });
    expect(await cast(erin, true)).toEqual(noVote);
  });

  test('a Client that connects once the vote is over hears of none', async () => {
    const [alice, , carol] = await groupOf('Alice', 'Bob', 'Carol');
    await voteOn(alice, 'Bob');
    await cast(carol, false);
    await alice.next('voteKickEnded');

    const carolAgain = await app.connectAsUser('Carol');

    expect(await Promise.race([carolAgain.next('voteKick'), settle()])).toBeUndefined();
  });

  test('non-Members never receive anything about a vote, Online already or not', async () => {
    const [alice, , carol, dave] = await groupOf('Alice', 'Bob', 'Carol', 'Dave');
    const erin = await app.connectAsUser('Erin');
    const heard = [watchFor('voteKick')(erin), watchFor('voteKickEnded')(erin)];
    await voteOn(alice, 'Bob');

    const frank = await app.connectAsUser('Frank');
    await cast(carol, false);
    await cast(dave, false);
    await settle();

    expect(heard.map(({ received }) => received)).toEqual([false, false]);
    expect(await Promise.race([frank.next('voteKick'), frank.next('voteKickEnded'), settle()])).toBeUndefined();
  });

  test('a Member who leaves hears nothing more about the vote', async () => {
    const [alice, , carol, dave, erin] = await groupOf('Alice', 'Bob', 'Carol', 'Dave', 'Erin');
    await voteOn(alice, 'Bob');
    await carol.socket.emitWithAck('leaveGroup', { name: 'Study' });
    const heard = [watchFor('voteKick')(carol), watchFor('voteKickEnded')(carol)];

    await cast(dave, true);
    await cast(erin, true);
    await settle();

    expect(heard.map(({ received }) => received)).toEqual([false, false]);
  });
});

describe('a vote is refused, and none starts,', () => {
  test.each<[string, 'Alice' | 'Dave', unknown, string]>([
    ['when the target is offline', 'Alice', { name: 'Study', target: 'Erin' }, 'You can only vote to kick a Member who is Online.'],
    ['when the target is not a Member', 'Alice', { name: 'Study', target: 'Dave' }, 'They are not a Member of this Group.'],
    ['when the target is nobody', 'Alice', { name: 'Study', target: 'Nobody' }, 'They are not a Member of this Group.'],
    ['when the target is not a name', 'Alice', { name: 'Study', target: { $ne: '' } }, 'They are not a Member of this Group.'],
    ['when the asker names themselves', 'Alice', { name: 'Study', target: 'alice' }, "You can't vote to kick yourself."],
    ['when the asker is not a Member', 'Dave', { name: 'Study', target: 'Bob' }, 'You are not a Member of this Group.'],
    ['when a non-Member names a Member as the asker', 'Dave', { name: 'Study', target: 'Bob', username: 'Alice' }, 'You are not a Member of this Group.'],
    ['when the Group does not exist', 'Alice', { name: 'Nowhere', target: 'Bob' }, 'There is no such Group.'],
    ['when there is no payload', 'Alice', undefined, 'There is no such Group.'],
  ])('%s', async (_, askerName, payload, error) => {
    const [alice, bob, carol, erin] = await groupOf('Alice', 'Bob', 'Carol', 'Erin');
    const dave = await app.connectAsUser('Dave');
    await goOffline(erin, 'Erin', dave);
    const heard = [alice, bob, carol, dave].map(watchFor('voteKick'));

    expect(await { Alice: alice, Dave: dave }[askerName].socket.emitWithAck('startVoteKick', payload as never)).toEqual({ ok: false, error });

    await settle();
    expect(heard.map(({ received }) => received)).toEqual([false, false, false, false]);
  });

  test('with fewer than 3 Members Online, counting the starter and the target', async () => {
    const [alice, , carol] = await groupOf('Alice', 'Bob', 'Carol');
    const dave = await app.connectAsUser('Dave');
    await goOffline(carol, 'Carol', dave);

    expect(await voteOn(alice, 'Bob')).toEqual({ ok: false, error: 'A vote needs at least 3 Members Online.' });
  });

  test('while another is running in the Group, though not in another Group', async () => {
    const [alice, bob, carol] = await groupOf('Alice', 'Bob', 'Carol');
    await voteOn(alice, 'Bob');

    expect(await voteOn(carol, 'Alice')).toEqual({ ok: false, error: 'A vote is already running in this Group.' });

    await alice.socket.emitWithAck('createGroup', 'Other');
    await bob.socket.emitWithAck('joinGroup', 'Other');
    await carol.socket.emitWithAck('joinGroup', 'Other');
    expect(await alice.socket.emitWithAck('startVoteKick', { name: 'Other', target: 'Bob' })).toEqual({ ok: true });
  });
});
