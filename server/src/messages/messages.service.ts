import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Message as SharedMessage, RoomMessagesAck } from '@compnet/shared';
import type { Model } from 'mongoose';
import { BOT_NAME } from '../bot/bot-name';
import { groupKeyOf } from '../groups/group-room';
import { GroupsService } from '../groups/groups.service';
import { OnlineListService } from '../online-list/online-list.service';
import { Message } from './message.schema';
import { isUserInPrivateRoom, privateRoomId } from './private-room';

export const MAX_MESSAGE_LENGTH = 1000;

@Injectable()
export class MessagesService {
  constructor(
    @InjectModel(Message.name) private readonly messages: Model<Message>,
    private readonly onlineList: OnlineListService,
    private readonly groups: GroupsService,
  ) {}

  /**
   * Opens the Private Room between `requester` and `targetUsername`.
   * Refuses if `targetUsername` is self or offline.
   */
  async openPrivateRoom(requester: string, targetUsername: unknown): Promise<RoomMessagesAck> {
    const target = typeof targetUsername === 'string' ? targetUsername.trim() : '';
    if (!target) return { ok: false, error: 'Enter a username.' };
    if (target.toLowerCase() === requester.toLowerCase()) {
      return { ok: false, error: 'Cannot open a Private Room with yourself.' };
    }
    if (!this.onlineList.isOnline(target)) {
      return { ok: false, error: `${target} is offline.` };
    }
    const roomId = privateRoomId(requester, target);
    const messages = await this.loadHistory(roomId);
    return { ok: true, roomId, messages };
  }

  /**
   * Loads the history of `roomId` for `requester`.
   * Refuses if `requester` is not a member of the Room.
   */
  async loadMessages(requester: string, roomIdInput: unknown): Promise<RoomMessagesAck> {
    const roomId = typeof roomIdInput === 'string' ? roomIdInput.trim() : '';
    if (!roomId) return { ok: false, error: 'Invalid room id.' };
    if (!(await this.isInRoom(requester, roomId))) {
      return { ok: false, error: 'You are not in this Room.' };
    }
    const messages = await this.loadHistory(roomId);
    return { ok: true, roomId, messages };
  }

  /** Saves a new Message into MongoDB and returns it stamped with the server's clock. */
  async send(
    sender: string,
    payload: unknown,
  ): Promise<{ ok: true; message: SharedMessage } | { ok: false; error: string }> {
    const { roomId, text } = (payload ?? {}) as { roomId?: unknown; text?: unknown };
    const cleanRoomId = typeof roomId === 'string' ? roomId.trim() : '';
    if (!cleanRoomId) return { ok: false, error: 'Invalid room id.' };
    if (!(await this.isInRoom(sender, cleanRoomId))) {
      return { ok: false, error: 'You are not in this Room.' };
    }
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed) return { ok: false, error: 'Enter a Message.' };
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      return { ok: false, error: `A Message can be at most ${MAX_MESSAGE_LENGTH} characters.` };
    }

    return { ok: true, message: await this.save(cleanRoomId, sender, trimmed) };
  }

  /** Saves the bot's reply. It skips `send`'s checks: the bot is in no Room, and its replies may be longer than a User's Message. */
  saveBotReply(roomId: string, text: string): Promise<SharedMessage> {
    return this.save(roomId, BOT_NAME, text);
  }

  /** The latest `limit` Messages of `roomId`, oldest first. */
  async recent(roomId: string, limit: number): Promise<SharedMessage[]> {
    const docs = await this.messages.find({ roomId }).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
    return docs.reverse().map(toSharedMessage);
  }

  private async save(roomId: string, sender: string, text: string): Promise<SharedMessage> {
    return toSharedMessage(await this.messages.create({ roomId, sender, text, createdAt: new Date() }));
  }

  /** Whether `username` may load and send in `roomId`: one of a Private Room's two Users, or a Group's Member (R7, R11). */
  async isInRoom(username: string, roomId: string): Promise<boolean> {
    const groupKey = groupKeyOf(roomId);
    if (groupKey !== undefined) return this.groups.isMember(groupKey, username);
    return isUserInPrivateRoom(username, roomId);
  }

  /** Loads full history for `roomId` in chronological order. */
  private async loadHistory(roomId: string): Promise<SharedMessage[]> {
    const docs = await this.messages.find({ roomId }).sort({ createdAt: 1, _id: 1 }).lean();
    return docs.map(toSharedMessage);
  }
}

function toSharedMessage({ roomId, sender, text, createdAt }: Message): SharedMessage {
  return { roomId, sender, text, createdAt: createdAt.toISOString() };
}
