import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Ack, GroupSummary } from '@compnet/shared';
import type { Model } from 'mongoose';
import { Group } from './group.schema';

export const MAX_GROUP_NAME_LENGTH = 30;

/**
 * Groups and their Members, saved in MongoDB. Knows nothing about sockets: the gateway passes in who is asking.
 * There is deliberately no way to leave, delete or add someone else to a Group (R10).
 */
@Injectable()
export class GroupsService implements OnModuleInit {
  constructor(@InjectModel(Group.name) private readonly groups: Model<Group>) {}

  async onModuleInit() {
    // Wait for the unique index, so duplicate names are refused from the very first create.
    await this.groups.init();
  }

  /** Creates a Group with `creator` as its only Member (R8). */
  async create(name: unknown, creator: string): Promise<Ack> {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) return { ok: false, error: 'Enter a Group name.' };
    if (trimmed.length > MAX_GROUP_NAME_LENGTH) {
      return { ok: false, error: `A Group name can be at most ${MAX_GROUP_NAME_LENGTH} characters.` };
    }
    try {
      await this.groups.create({
        name: trimmed,
        key: trimmed.toLowerCase(),
        members: [creator],
        memberKeys: [creator.toLowerCase()],
      });
    } catch (err) {
      // Left to the unique index rather than checked first, so two Users creating the same name at once can't both succeed.
      if ((err as { code?: number }).code === 11000) return { ok: false, error: `A Group named ${trimmed} already exists.` };
      throw err;
    }
    return { ok: true };
  }

  /** Adds `username`, and only them, to the Group named `name` (R10). */
  async join(name: unknown, username: string): Promise<Ack> {
    const key = typeof name === 'string' ? name.trim().toLowerCase() : '';
    const userKey = username.toLowerCase();
    // One atomic update that only matches if the User isn't a Member yet, so a double click can't add them twice.
    const joined = await this.groups.findOneAndUpdate(
      { key, memberKeys: { $ne: userKey } },
      { $push: { members: username, memberKeys: userKey } },
    );
    if (joined) return { ok: true };
    const group = await this.groups.exists({ key });
    return { ok: false, error: group ? 'You are already a Member of this Group.' : 'There is no such Group.' };
  }

  /** Every Group with its Members, oldest first (R9). */
  async list(): Promise<GroupSummary[]> {
    const groups = await this.groups.find().sort({ _id: 1 }).lean();
    return groups.map(({ name, members }) => ({ name, members }));
  }
}
