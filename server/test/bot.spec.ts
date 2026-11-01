import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { User } from '../src/users/user.schema';
import { startApp, type TestClient } from './app';
import { startFakeAi } from './fake-ai';

const UNAVAILABLE = 'bot is unavailable right now';

let app: Awaited<ReturnType<typeof startApp>>;
let ai: Awaited<ReturnType<typeof startFakeAi>>;
let alice: TestClient;
let bob: TestClient;
const roomId = 'alice:bob';

beforeEach(async () => {
  ai = await startFakeAi();
  process.env.AI_BASE_URL = ai.url;
  process.env.AI_MODEL = 'fake-model';
  process.env.AI_API_KEY = 'fake-key';
  app = await startApp();
  alice = await app.connectAsUser('Alice');
  bob = await app.connectAsUser('Bob');
  await alice.socket.emitWithAck('openPrivateRoom', 'Bob');
});
afterEach(async () => {
  await app.close();
  ai.close();
});

function send(text: string) {
  return alice.socket.emitWithAck('sendMessage', { roomId, text });
}

/** Waits for the bot's reply on Alice's Client, skipping her own Messages. */
async function botReply() {
  for (;;) {
    const message = await alice.next('message');
    if (message.sender === 'bot') return message;
  }
}

test('both Users see the reply to an @bot Message, and it stays in the history', async () => {
  ai.behave({ chunks: ['TCP is ', 'reliable.'] });

  expect(await send('@bot what is TCP?')).toEqual({ ok: true });

  expect((await alice.next('message')).text).toBe('@bot what is TCP?');
  expect((await bob.next('message')).text).toBe('@bot what is TCP?');
  expect(await alice.next('message')).toMatchObject({ roomId, sender: 'bot', text: 'TCP is reliable.' });
  expect(await bob.next('message')).toMatchObject({ roomId, sender: 'bot', text: 'TCP is reliable.' });

  const history = await bob.socket.emitWithAck('loadMessages', roomId);
  expect(history.ok && history.messages.map((message) => message.sender)).toEqual(['Alice', 'bot']);
});

test('the reply streams to both Users piece by piece', async () => {
  ai.behave({ chunks: ['TCP is ', 'reliable.'] });

  await send('@bot what is TCP?');

  for (const client of [alice, bob]) {
    expect(await client.next('botChunk')).toEqual({ roomId, text: 'TCP is ' });
    expect(await client.next('botChunk')).toEqual({ roomId, text: 'reliable.' });
  }
});

test('a third User receives nothing of the reply', async () => {
  const carol = await app.connectAsUser('Carol');
  const received: string[] = [];
  carol.socket.on('message', () => received.push('message'));
  carol.socket.on('botChunk', () => received.push('botChunk'));

  await send('@bot hi');
  await botReply();
  await bob.next('botChunk');

  expect(received).toEqual([]);
});

test('the model gets the rules and the last 6 Messages, each with its sender', async () => {
  for (let i = 1; i <= 6; i++) await send(`message ${i}`);
  await send('@bot sum this up');
  await botReply();

  const [{ model, messages }] = ai.requests;
  expect(model).toBe('fake-model');
  expect(messages[0].role).toBe('system');
  expect(messages.slice(1)).toEqual([
    { role: 'user', content: 'Alice: message 2' },
    { role: 'user', content: 'Alice: message 3' },
    { role: 'user', content: 'Alice: message 4' },
    { role: 'user', content: 'Alice: message 5' },
    { role: 'user', content: 'Alice: message 6' },
    { role: 'user', content: 'Alice: @bot sum this up' },
  ]);
});

test("the bot's earlier replies reach the model as its own", async () => {
  ai.behave({ chunks: ['first answer'] });
  await send('@bot one');
  await botReply();

  await send('@bot two');
  await botReply();

  expect(ai.requests[1].messages.slice(1)).toEqual([
    { role: 'user', content: 'Alice: @bot one' },
    { role: 'assistant', content: 'first answer' },
    { role: 'user', content: 'Alice: @bot two' },
  ]);
});

test.each(['hello', 'hi @bot', '@bottle of water'])('%s gets no reply and no AI call', async (text) => {
  await send(text);
  await new Promise((resolve) => setTimeout(resolve, 100));

  expect(ai.requests).toEqual([]);
});

test.each(['@bot hi', '@BOT hi', '  @bot hi', '@bot'])('%s asks the bot', async (text) => {
  await send(text);

  expect((await botReply()).text).toBe('hello');
});

test('a second @bot while the bot is answering gets no second reply', async () => {
  let release = () => {};
  ai.behave({ heldUntil: new Promise<void>((resolve) => (release = resolve)), chunks: ['done'] });

  await send('@bot one');
  await send('@bot two');
  release();
  await botReply();
  await new Promise((resolve) => setTimeout(resolve, 100));

  expect(ai.requests).toHaveLength(1);
});

test('the bot can answer again after an earlier reply finished', async () => {
  await send('@bot one');
  await botReply();
  await send('@bot two');
  await botReply();

  expect(ai.requests).toHaveLength(2);
});

test('a failing AI gets the unavailable reply, and the chat carries on', async () => {
  ai.behave({ status: 500 });

  await send('@bot hi');
  expect(await botReply()).toMatchObject({ sender: 'bot', text: UNAVAILABLE });

  await send('still chatting');
  expect((await bob.next('message')).text).toBe('@bot hi');
  expect((await bob.next('message')).text).toBe(UNAVAILABLE);
  expect((await bob.next('message')).text).toBe('still chatting');
});

test('failure notices stay out of what the model sees', async () => {
  ai.behave({ status: 500 });
  await send('@bot one');
  await botReply();

  ai.behave({ chunks: ['fine'] });
  await send('@bot two');
  await botReply();

  expect(ai.requests[1].messages.slice(1)).toEqual([
    { role: 'user', content: 'Alice: @bot one' },
    { role: 'user', content: 'Alice: @bot two' },
  ]);
});

test('an unset API key gets the unavailable reply', async () => {
  delete process.env.AI_API_KEY;

  await send('@bot hi');

  expect((await botReply()).text).toBe(UNAVAILABLE);
});

test('an empty answer gets the unavailable reply', async () => {
  ai.behave({ chunks: ['  '] });

  await send('@bot hi');

  expect((await botReply()).text).toBe(UNAVAILABLE);
});

test('10 seconds of silence get the unavailable reply', async () => {
  ai.behave('silent');
  const started = Date.now();

  await send('@bot hi');

  expect((await botReply()).text).toBe(UNAVAILABLE);
  expect(Date.now() - started).toBeGreaterThanOrEqual(9_900);
  expect(Date.now() - started).toBeLessThan(12_000);
});

test.each(['bot', 'BOT', 'Bot'])('nobody can register as %s', async (username) => {
  await expect(app.connect({ mode: 'register', username, password: 'secret' })).rejects.toThrow('That name is reserved.');
});

test('an account named bot from before the reservation can no longer log in', async () => {
  const users = app.app.get<Model<User>>(getModelToken(User.name));
  await users.create({ username: 'Bot', usernameLower: 'bot', passwordHash: 'unused' });

  await expect(app.connect({ mode: 'login', username: 'Bot', password: 'secret' })).rejects.toThrow(
    'Wrong username or password.',
  );
});
