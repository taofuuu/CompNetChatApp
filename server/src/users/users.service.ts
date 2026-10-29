import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { compare, hash } from 'bcrypt';
import type { Model } from 'mongoose';
import { RefusalError } from '../refusal-error';
import { User } from './user.schema';

/** Registers Users and checks their passwords. */
@Injectable()
export class UsersService implements OnModuleInit {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  async onModuleInit() {
    // Wait for the unique index, so taken usernames are refused from the very first registration.
    await this.users.init();
  }

  /** Saves a new User and returns their username. */
  async register(username: string, password: string) {
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) throw new RefusalError('A username is 3 to 20 letters, digits or underscores.');
    if (!password) throw new RefusalError('Enter a password.');
    const passwordHash = await hash(password, 10);
    try {
      await this.users.create({ username, usernameLower: username.toLowerCase(), passwordHash });
    } catch (err) {
      // The unique index on usernameLower refuses a taken name, even when two people register it at once.
      if ((err as { code?: number }).code === 11000) throw new RefusalError(`${username} is already taken.`);
      throw err;
    }
    return username;
  }

  /** Returns the User's username as they first typed it. */
  async logIn(username: string, password: string) {
    const user = await this.users.findOne({ usernameLower: username.toLowerCase() });
    // The same reason either way, so a refusal doesn't reveal which usernames are registered.
    if (!user || !(await compare(password, user.passwordHash))) throw new RefusalError('Wrong username or password.');
    return user.username;
  }
}
