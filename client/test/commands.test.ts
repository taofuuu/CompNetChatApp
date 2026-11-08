import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCommand, voteToCast } from '../src/commands.ts';

test('a line that is not a Command stays a Message', () => {
  for (const line of ['hello', '@bot what is TCP?', '/', '//', '/etc/hosts', '/kick/bob', ' a /kick b']) {
    assert.equal(parseCommand(line), undefined, line);
  }
});

test('a Command is read, ignoring the case of its word and spaces around it', () => {
  const commands: [string, unknown][] = [
    ['/help', { name: 'help' }],
    ['  /HELP  ', { name: 'help' }],
    ['/leave', { name: 'leave' }],
    ['/unsend', { name: 'unsend' }],
    ['/kick bob', { name: 'kick', target: 'bob' }],
    ['/Kick   BOB ', { name: 'kick', target: 'BOB' }],
    ['/vote yes', { name: 'vote', yes: true }],
    ['/vote NO', { name: 'vote', yes: false }],
    ['/msg bob', { name: 'msg', user: 'bob' }],
    ['/join Lab', { name: 'join', group: 'Lab' }],
    ['/join Study Group', { name: 'join', group: 'Study Group' }],
  ];
  for (const [line, command] of commands) assert.deepEqual(parseCommand(line), command, line);
});

test('a Command missing its name, or with a wrong answer, says how to use it', () => {
  const hints: [string, string][] = [
    ['/kick', 'Use /kick name.'],
    ['/msg', 'Use /msg name.'],
    ['/join', 'Use /join Group.'],
    ['/vote', 'Use /vote yes or /vote no.'],
    ['/vote maybe', 'Use /vote yes or /vote no.'],
  ];
  for (const [line, error] of hints) assert.deepEqual(parseCommand(line), { error }, line);
});

test('an unknown Command is not sent as a Message: it gets a hint', () => {
  assert.deepEqual(parseCommand('/foo'), { error: 'There is no /foo Command. Try /help.' });
  assert.deepEqual(parseCommand('/shrug hello there'), { error: 'There is no /shrug Command. Try /help.' });
});

test('the keys act on the open Room vote that waits for the viewer, otherwise the oldest that does', () => {
  const lab = { roomId: '#lab', waitingFor: ['alice'] };
  const study = { roomId: '#study', waitingFor: ['alice'] };
  const voted = { roomId: '#voted', waitingFor: ['bob'] };

  assert.equal(voteToCast([lab, study], 'alice', '#study'), study);
  assert.equal(voteToCast([lab, study], 'alice', '#other'), lab);
  assert.equal(voteToCast([lab, study], 'alice'), lab);
  assert.equal(voteToCast([voted, study], 'alice', '#voted'), study);
  assert.equal(voteToCast([voted], 'alice', '#voted'), undefined);
  assert.equal(voteToCast([], 'alice', '#lab'), undefined);
});

test('the keys skip a vote showing its result, though it still lists the viewer', () => {
  const decided = { roomId: '#decided', waitingFor: ['alice'], outcome: 'passed' as const };
  const lab = { roomId: '#lab', waitingFor: ['alice'] };

  assert.equal(voteToCast([decided, lab], 'alice', '#decided'), lab);
  assert.equal(voteToCast([decided], 'alice'), undefined);
});
