import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { UsersModule } from '../src/users/users.module';
import { UsersService } from '../src/users/users.service';
import { freshDatabaseUri } from './mongo';

// The username and password rules, straight on UsersService. How they reach a Client is in register-and-log-in.spec.ts.

/** Boots just the Users module against a fresh, empty database. */
async function startUsers() {
  return NestFactory.createApplicationContext(
    { module: class {}, imports: [MongooseModule.forRoot(await freshDatabaseUri()), UsersModule] },
    { logger: false },
  );
}

// One context for the whole file, emptied before each test.
let context: INestApplicationContext;
let users: UsersService;
beforeAll(async () => {
  context = await startUsers();
  users = context.get(UsersService);
});
beforeEach(async () => {
  const connection = context.get<Connection>(getConnectionToken());
  await Promise.all(Object.values(connection.collections).map((collection) => collection.deleteMany({})));
});
afterAll(() => context?.close());

test('a registered User can log in with their password', async () => {
  expect(await users.register('Alice', 'secret')).toBe('Alice');

  expect(await users.logIn('Alice', 'secret')).toBe('Alice');
});

test('logging in with the wrong password is refused', async () => {
  await users.register('Alice', 'secret');

  await expect(users.logIn('Alice', 'Secret')).rejects.toThrow('Wrong username or password.');
});

test('logging in as a username nobody registered is refused', async () => {
  await expect(users.logIn('Nobody', 'secret')).rejects.toThrow('Wrong username or password.');
});

test('a User logs in with any case of their username and gets it back as first typed', async () => {
  await users.register('Alice', 'secret');

  expect(await users.logIn('aLICE', 'secret')).toBe('Alice');
});

test('registering a username already taken, ignoring case, is refused', async () => {
  await users.register('Alice', 'secret');

  await expect(users.register('alice', 'other')).rejects.toThrow('alice is already taken.');
});

test('registering the same name twice at once, right after the server starts, lets only one through', async () => {
  const fresh = await startUsers();
  try {
    const service = fresh.get(UsersService);

    const results = await Promise.allSettled([service.register('Alice', 'secret'), service.register('alice', 'other')]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
  } finally {
    await fresh.close();
  }
});

test.each(['ab', 'a'.repeat(21), 'has space', 'dash-name', 'émile', ''])('registering the username %p is refused by the name rule', async (username) => {
  await expect(users.register(username, 'secret')).rejects.toThrow('A username is 3 to 20 letters, digits or underscores.');
});

test.each(['abc', 'a'.repeat(20), 'Under_Score_9'])('registering the username %p is allowed', async (username) => {
  expect(await users.register(username, 'secret')).toBe(username);
});

test('registering with an empty password is refused', async () => {
  await expect(users.register('Alice', '')).rejects.toThrow('Enter a password.');
});
