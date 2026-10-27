import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Connection } from 'mongoose';
import { UsersModule } from '../src/users/users.module';
import { UsersService } from '../src/users/users.service';

// One in-memory MongoDB for the whole file, emptied before each test: starting mongod is the slow part.
let mongo: MongoMemoryServer;
let context: INestApplicationContext;
let users: UsersService;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  context = await NestFactory.createApplicationContext(
    { module: class {}, imports: [MongooseModule.forRoot(mongo.getUri()), UsersModule] },
    { logger: false },
  );
  users = context.get(UsersService);
});
beforeEach(async () => {
  const connection = context.get<Connection>(getConnectionToken());
  await Promise.all(Object.values(connection.collections).map((collection) => collection.deleteMany({})));
});
afterAll(async () => {
  await context?.close();
  await mongo?.stop();
});

test('a registered User can log in with their password', async () => {
  expect(await users.register('Alice', 'secret')).toBe('Alice');

  expect(await users.logIn('Alice', 'secret')).toBe('Alice');
});

test('logging in with the wrong password is refused', async () => {
  await users.register('Alice', 'secret');

  await expect(users.logIn('Alice', 'Secret')).rejects.toThrow('Wrong username or password.');
});

test('a User logs in with any case of their username and gets it back as first typed', async () => {
  await users.register('Alice', 'secret');

  expect(await users.logIn('aLICE', 'secret')).toBe('Alice');
});

test('registering a username already taken, ignoring case, is refused', async () => {
  await users.register('Alice', 'secret');

  await expect(users.register('alice', 'other')).rejects.toThrow('alice is already taken.');
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

// The only test that looks inside the database: what is stored there is the rule under test.
test('the Users collection keeps a bcrypt hash of the password, never the password itself', async () => {
  await users.register('Alice', 'secret');

  const stored = await context.get<Connection>(getConnectionToken()).collection('users').find().toArray();
  expect(stored).toEqual([
    { _id: expect.anything(), __v: 0, username: 'Alice', usernameLower: 'alice', passwordHash: expect.stringMatching(/^\$2b\$10\$/) },
  ]);
  expect(JSON.stringify(stored)).not.toContain('secret');
});

test('logging in as a username nobody registered is refused', async () => {
  await expect(users.logIn('Nobody', 'secret')).rejects.toThrow('Wrong username or password.');
});
