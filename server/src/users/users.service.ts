import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { compare, hash } from 'bcrypt';
import type { Model } from 'mongoose';
import { User } from './user.schema';

/** Registers Users and checks their passwords. */
@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  /** Saves a new User and returns their username. */
  async register(username: string, password: string) {
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) throw new Error('A username is 3 to 20 letters, digits or underscores.');
    if (!password) throw new Error('Enter a password.');
    const passwordHash = await hash(password, 10);
    try {
      await this.users.create({ username, usernameLower: username.toLowerCase(), passwordHash });
    } catch (err) {
      // The unique index on usernameLower refuses a taken name, even when two people register it at once.
      if ((err as { code?: unknown }).code === 11000) throw new Error(`${username} is already taken.`);
      throw err;
    }
    return username;
  }

  /** Returns the User's username as they first typed it. */
  async logIn(username: string, password: string) {
    const user = await this.users.findOne({ usernameLower: username.toLowerCase() });
    // The same reason either way, so a refusal doesn't reveal which usernames are registered.
    if (!user || !(await compare(password, user.passwordHash))) throw new Error('Wrong username or password.');
    return user.username;
  }
}
