import { randomUUID } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';

// One in-memory MongoDB per test file, started on first use: starting mongod is the slow part.
let mongo: Promise<MongoMemoryServer> | undefined;
afterAll(async () => {
  await (await mongo)?.stop();
  mongo = undefined;
});

/** The URI of a fresh, empty database on this test file's in-memory MongoDB. */
export async function freshDatabaseUri() {
  mongo ??= MongoMemoryServer.create();
  return (await mongo).getUri(`test-${randomUUID()}`);
}
