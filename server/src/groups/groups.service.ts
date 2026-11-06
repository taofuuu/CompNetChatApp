import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Ack, Announcement as SharedAnnouncement, GroupSummary, KickBlock, LeaveGroupAck } from '@compnet/shared';
import type { Model } from 'mongoose';
import { Message } from '../messages/message.schema';
import { OnlineListService } from '../online-list/online-list.service';
import { Announcement } from './announcement.schema';
import { Group } from './group.schema';
import { groupRoomId } from './group-room';

export const MAX_GROUP_NAME_LENGTH = 30;
/** How long a kicked User can't join the Group. */
const KICK_BLOCK_MS = 10 * 60_000;
/** With fewer, the starter and the target alone would decide. */
const MIN_ONLINE_FOR_VOTE_KICK = 3;

/** Whether a Vote Kick can start, and if so, the names it needs. */
type VoteKickCheck = { ok: true; group: string; target: string; otherVoters: string[] } | { ok: false; error: string };

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
    private readonly onlineList: OnlineListService,
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

  /** Adds `username`, and only them, to the Group named `name` (R10), unless a Kick or Vote Kick still blocks them. */
  async join(name: unknown, username: string): Promise<Ack> {
    const key = toKey(name);
    const userKey = username.toLowerCase();
    // One atomic update that only matches if the User isn't a Member yet and isn't blocked, so a double click can't add them twice.
    const joined = await this.groups.findOneAndUpdate(
      { key, memberKeys: { $ne: userKey }, [`blockedUntil.${userKey}`]: { $not: { $gt: new Date() } } },
      { $push: { members: username, memberKeys: userKey } },
    );
    if (joined) return { ok: true };
    const group = await this.groups.findOne({ key }).lean();
    if (!group) return { ok: false, error: 'There is no such Group.' };
    const blockedUntil = group.blockedUntil?.[userKey];
    if (blockedUntil && !group.memberKeys.includes(userKey)) {
      return { ok: false, error: `You were kicked from this Group. You can join again in ${formatTimeLeft(blockedUntil.getTime() - Date.now())}.` };
    }
    return { ok: false, error: 'You are already a Member of this Group.' };
  }

  /**
   * Removes the offline Member `target` from the Group named `name` for `asker`, and blocks them from joining for a while.
   * `target` must have joined after `asker`: otherwise a stranger could join a Group whose Members are all offline, kick them all and delete its history by leaving.
   */
  async kick(name: unknown, target: unknown, asker: string): Promise<{ ok: true; kicked: string } | { ok: false; error: string }> {
    const key = toKey(name);
    const targetKey = toKey(target);
    const askerKey = asker.toLowerCase();
    const group = await this.groups.findOne({ key }).lean();
    if (!group) return { ok: false, error: 'There is no such Group.' };
    const askerAt = group.memberKeys.indexOf(askerKey);
    const targetAt = group.memberKeys.indexOf(targetKey);
    if (askerAt === -1) return { ok: false, error: 'You are not a Member of this Group.' };
    if (targetAt === -1) return { ok: false, error: 'They are not a Member of this Group.' };
    if (targetAt <= askerAt) return { ok: false, error: 'You can only kick Members who joined after you.' };
    // shortcut: someone coming Online between this check and the update is kicked all the same, and the gateway tells their Client; check again after the update if Users hit this.
    if (this.onlineList.isOnline(targetKey)) return { ok: false, error: 'You can only kick a Member who is offline.' };
    // The name as stored: an old Group may have it in another spelling.
    const kicked = group.members[targetAt];
    // One atomic update that only matches while both are Members, so a double click kicks once and the asker leaving at this moment can't leave the Group empty.
    const updated = await this.groups.findOneAndUpdate({ key, memberKeys: { $all: [askerKey, targetKey] } }, removeAndBlock(kicked));
    return updated ? { ok: true, kicked } : { ok: false, error: 'They are not a Member of this Group.' };
  }

  /** Removes the Member `target` a Vote Kick passed against, with the block of a Kick. False if they're gone already. Never the last Member, so a Group is never empty. */
  async voteOut(group: string, target: string): Promise<boolean> {
    const updated = await this.groups.findOneAndUpdate(
      { key: group.toLowerCase(), memberKeys: target.toLowerCase(), 'memberKeys.1': { $exists: true } },
      removeAndBlock(target),
    );
    return updated !== null;
  }

  /** Checks `asker` can start a Vote Kick on `target` in the Group named `name`, and says who else votes: the Online Members, fixed from now on. */
  async checkVoteKick(name: unknown, target: unknown, asker: string): Promise<VoteKickCheck> {
    const targetKey = toKey(target);
    const askerKey = asker.toLowerCase();
    const group = await this.groups.findOne({ key: toKey(name) }).lean();
    if (!group) return { ok: false, error: 'There is no such Group.' };
    if (!group.memberKeys.includes(askerKey)) return { ok: false, error: 'You are not a Member of this Group.' };
    const targetAt = group.memberKeys.indexOf(targetKey);
    if (targetAt === -1) return { ok: false, error: 'They are not a Member of this Group.' };
    if (targetKey === askerKey) return { ok: false, error: "You can't vote to kick yourself." };
    if (!this.onlineList.isOnline(targetKey)) return { ok: false, error: 'You can only vote to kick a Member who is Online.' };
    const online = group.memberKeys.filter((key) => this.onlineList.isOnline(key));
    if (online.length < MIN_ONLINE_FOR_VOTE_KICK) return { ok: false, error: `A vote needs at least ${MIN_ONLINE_FOR_VOTE_KICK} Members Online.` };
    return {
      ok: true,
      group: group.name,
      // The name as stored: an old Group may have it in another spelling.
      target: group.members[targetAt],
      otherVoters: online.filter((key) => key !== targetKey && key !== askerKey),
    };
  }

  /** Every block running on `username`. */
  async kickBlocksOf(username: string): Promise<KickBlock[]> {
    const userKey = username.toLowerCase();
    const now = new Date();
    const groups = await this.groups.find({ [`blockedUntil.${userKey}`]: { $gt: now } }).lean();
    return groups.map(({ name, blockedUntil }) => ({ name, msLeft: blockedUntil![userKey].getTime() - now.getTime() }));
  }

  /**
   * Removes `username`, and only them, from the Group named `name`.
   * The last Member is refused unless `confirmed`, which deletes the Group, so its history is never wiped without a prompt and a Group is never empty.
   */
  async leave(name: unknown, username: string, confirmed: boolean): Promise<LeaveGroupAck> {
    const key = toKey(name);
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

/** The lowercase form of a name a Client sent. Anything but a string becomes '', which matches nothing. */
function toKey(name: unknown) {
  return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

/** The update that removes `member`, spelled as stored, and blocks them from joining for a while. */
function removeAndBlock(member: string) {
  const key = member.toLowerCase();
  return { $pull: { members: member, memberKeys: key }, $set: { [`blockedUntil.${key}`]: new Date(Date.now() + KICK_BLOCK_MS) } };
}

/** `ms` as minutes and seconds, rounded up, e.g. 9:05. */
function formatTimeLeft(ms: number) {
  const seconds = Math.max(Math.ceil(ms / 1000), 0);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function toSharedAnnouncement({ roomId, text, createdAt }: Announcement): SharedAnnouncement {
  return { roomId, text, createdAt: createdAt.toISOString() };
}
