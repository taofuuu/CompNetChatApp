import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Ack, Announcement as SharedAnnouncement, GroupSummary, LeaveGroupAck } from '@compnet/shared';
import type { Model } from 'mongoose';
import { Message } from '../messages/message.schema';
import { Announcement } from './announcement.schema';
import { Group } from './group.schema';
import { groupRoomId } from './group-room';

export const MAX_GROUP_NAME_LENGTH = 30;

/**
 * Groups, their Members and their Announcements, saved in MongoDB, and the end of a deleted Group's Messages.
 * Knows nothing about sockets: the gateway passes in who is asking.
 * There is deliberately no way to add someone else to a Group (R10).
 */
@Injectable()
export class GroupsService implements OnModuleInit {
  /**
   * The latest deletion of each Group's Room. In memory: only work running right now needs to know.
   * shortcut: never pruned, one small entry per deleted Group name until a restart; prune it if names ever churn.
   */
  private readonly deletions = new Map<string, symbol>();

  constructor(
    @InjectModel(Group.name) private readonly groups: Model<Group>,
    @InjectModel(Announcement.name) private readonly announcements: Model<Announcement>,
    @InjectModel(Message.name) private readonly messages: Model<Message>,
  ) {}

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
    // Whatever an earlier Group with this name left: an Announcement saved as it was deleted, or a wipe the server died during. Before anyone hears of this Group.
    await this.wipeHistory(groupRoomId(trimmed));
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

  /**
   * Removes `username`, and only them, from the Group named `name`.
   * The last Member is refused unless `confirmed`, which deletes the Group, so its history is never wiped without a prompt and a Group is never empty.
   */
  async leave(name: unknown, username: string, confirmed: boolean): Promise<LeaveGroupAck> {
    const key = typeof name === 'string' ? name.trim().toLowerCase() : '';
    const userKey = username.toLowerCase();
    // One atomic delete that only matches while they are alone: a User who joined first keeps the Group alive, and one joining after finds no Group.
    // Before the wipe, so the history is never lost while the Group has a Member.
    // shortcut: the name is free just before the wipe ends, so a Group created in that moment could lose its first Announcement; hold the name until then if Users hit this.
    if (confirmed && (await this.groups.findOneAndDelete({ key, memberKeys: [userKey] }))) {
      const roomId = groupRoomId(key);
      this.deletions.set(roomId, Symbol());
      await this.wipeHistory(roomId);
      return { ok: true, deleted: true };
    }
    // One atomic update that only matches while someone else stays, so a double click or two Members leaving at once can't go wrong.
    // Ignoring case, because an old Group may store the name in another spelling. A username is only letters, digits and underscores, so nothing in it needs escaping.
    const left = await this.groups.findOneAndUpdate(
      { key, memberKeys: userKey, 'memberKeys.1': { $exists: true } },
      { $pull: { members: new RegExp(`^${username}$`, 'i'), memberKeys: userKey } },
    );
    if (left) return { ok: true };
    const group = await this.groups.findOne({ key }).lean();
    if (!group) return { ok: false, error: 'There is no such Group.' };
    if (!group.memberKeys.includes(userKey)) return { ok: false, error: 'You are not a Member of this Group.' };
    return { ok: false, lastMember: true, error: 'You are the last Member of this Group: leaving deletes it for good.' };
  }

  /** Whether `username` is a Member of the Group whose lowercase name is `key` (R11). */
  async isMember(key: string, username: string): Promise<boolean> {
    return (await this.groups.exists({ key, memberKeys: username.toLowerCase() })) !== null;
  }

  /** Returns a check of whether the Group of `roomId` has been deleted since this call, even if a new Group has taken its name. */
  watchForDeletion(roomId: string) {
    const before = this.deletions.get(roomId);
    return () => this.deletions.get(roomId) !== before;
  }

  /** Every Group with its Members, oldest first (R9). */
  async list(): Promise<GroupSummary[]> {
    const groups = await this.groups.find().sort({ _id: 1 }).lean();
    return groups.map(({ name, members }) => ({ name, members }));
  }

  /** Saves an Announcement into the Group's Room `roomId`. */
  async announce(roomId: string, text: string): Promise<SharedAnnouncement> {
    return toSharedAnnouncement(await this.announcements.create({ roomId, text }));
  }

  /** Every Announcement of `roomId`, oldest first. A Private Room has none. */
  async announcementsOf(roomId: string): Promise<SharedAnnouncement[]> {
    const docs = await this.announcements.find({ roomId }).sort({ createdAt: 1, _id: 1 }).lean();
    return docs.map(toSharedAnnouncement);
  }

  /** Deletes every Message and Announcement of a Group's Room. */
  private async wipeHistory(roomId: string) {
    await Promise.all([this.messages.deleteMany({ roomId }), this.announcements.deleteMany({ roomId })]);
  }
}

function toSharedAnnouncement({ roomId, text, createdAt }: Announcement): SharedAnnouncement {
  return { roomId, text, createdAt: createdAt.toISOString() };
}
