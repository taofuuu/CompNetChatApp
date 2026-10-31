import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Message as SharedMessage, RoomMessagesAck } from '@compnet/shared';
import type { Model } from 'mongoose';
import { OnlineListService } from '../online-list/online-list.service';
import { Message } from './message.schema';
import { isUserInPrivateRoom, privateRoomId } from './private-room';

export const MAX_MESSAGE_LENGTH = 1000;

@Injectable()
export class MessagesService {
  constructor(
    @InjectModel(Message.name) private readonly messages: Model<Message>,
    private readonly onlineList: OnlineListService,
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
    return { ok: true, roomId, messages, history: messages };
  }

  /**
   * Loads the history of `roomId` for `requester`.
   * Refuses if `requester` is not a member of the Room.
   */
  async loadMessages(requester: string, roomIdInput: unknown): Promise<RoomMessagesAck> {
    const roomId = typeof roomIdInput === 'string' ? roomIdInput.trim() : '';
    if (!roomId) return { ok: false, error: 'Invalid room id.' };
    if (!isUserInPrivateRoom(requester, roomId)) {
      return { ok: false, error: 'You are not in this Room.' };
    }
    const messages = await this.loadHistory(roomId);
    return { ok: true, roomId, messages, history: messages };
  }

  /** Saves a new Message into MongoDB and returns it stamped with the server's clock. */
  async send(
    sender: string,
    payload: unknown,
  ): Promise<{ ok: true; message: SharedMessage } | { ok: false; error: string }> {
    let roomId: unknown;
    let text: unknown;
    if (payload && typeof payload === 'object') {
      const obj = payload as { roomId?: unknown; text?: unknown };
      roomId = obj.roomId;
      text = obj.text;
    }
    const cleanRoomId = typeof roomId === 'string' ? roomId.trim() : '';
    if (!cleanRoomId) return { ok: false, error: 'Invalid room id.' };
    if (!isUserInPrivateRoom(sender, cleanRoomId)) {
      return { ok: false, error: 'You are not in this Room.' };
    }
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed) return { ok: false, error: 'Enter a Message.' };
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      return { ok: false, error: `A Message can be at most ${MAX_MESSAGE_LENGTH} characters.` };
    }

    const now = new Date();
    const created = await this.messages.create({
      roomId: cleanRoomId,
      sender,
      text: trimmed,
      createdAt: now,
    });

    const iso = created.createdAt.toISOString();
    return {
      ok: true,
      message: {
        roomId: cleanRoomId,
        sender,
        text: trimmed,
        createdAt: iso,
        timestamp: iso,
        time: iso,
      },
    };
  }

  /** Loads full history for `roomId` in chronological order. */
  private async loadHistory(roomId: string): Promise<SharedMessage[]> {
    const docs = await this.messages.find({ roomId }).sort({ createdAt: 1, _id: 1 }).lean();
    return docs.map((doc) => {
      const iso = doc.createdAt instanceof Date ? doc.createdAt.toISOString() : new Date(doc.createdAt).toISOString();
      return {
        roomId: doc.roomId,
        sender: doc.sender,
        text: doc.text,
        createdAt: iso,
        timestamp: iso,
        time: iso,
      };
    });
  }
}
