import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type {
  Ack,
  ClientToServerEvents,
  RoomMessagesAck,
  ServerToClientEvents,
} from '@compnet/shared';
import type { DefaultEventsMap, Server, Socket } from 'socket.io';
import { BOT_NAME } from '../bot/bot-name';
import { BOT_CONTEXT_MESSAGES, BOT_UNAVAILABLE, BotService, mentionsBot } from '../bot/bot.service';
import { groupKeyOf } from '../groups/group-room';
import type { SocketData } from '../socket-data';
import { MessagesService } from './messages.service';

type ChatServer = Server<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>;
type ChatSocket = Socket<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>;

// ADR-0001: WebSocket only.
@WebSocketGateway({ transports: ['websocket'] })
export class MessagesGateway implements OnGatewayConnection {
  @WebSocketServer() private server: ChatServer;

  private readonly logger = new Logger(MessagesGateway.name);
  /**
   * Rooms the bot is answering in right now, and the Users who asked. A Room gets one reply at a time, so two can't mix in
   * its one streaming bubble. A User gets one too: Room ids can be made up, so a per-Room lock alone lets one User start
   * any number of AI calls. Usernames can't contain `:`, so they never clash with Room ids.
   */
  private readonly botAnswering = new Set<string>();

  constructor(
    private readonly messagesService: MessagesService,
    private readonly bot: BotService,
  ) {}

  handleConnection(socket: ChatSocket) {
    socket.join(`user:${socket.data.username.toLowerCase()}`);
  }

  @SubscribeMessage('openPrivateRoom')
  async openPrivateRoom(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody() targetUsername: unknown,
  ): Promise<RoomMessagesAck> {
    return this.messagesService.openPrivateRoom(socket.data.username, targetUsername);
  }

  @SubscribeMessage('loadMessages')
  async loadMessages(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody() roomId: unknown,
  ): Promise<RoomMessagesAck> {
    return this.messagesService.loadMessages(socket.data.username, roomId);
  }

  @SubscribeMessage('sendMessage')
  async sendMessage(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody() payload: unknown,
  ): Promise<Ack> {
    const result = await this.messagesService.send(socket.data.username, payload);
    if (result.ok) {
      this.toRoom(result.message.roomId).emit('message', result.message);
      // Not awaited: the sender's acknowledgement shouldn't wait for the AI.
      if (mentionsBot(result.message.text)) void this.answerAsBot(result.message.roomId, socket.data.username.toLowerCase(), result.groupDeleted);
      return { ok: true };
    }
    return { ok: false, error: result.error };
  }

  @SubscribeMessage('unsendMessage')
  async unsendMessage(@ConnectedSocket() socket: ChatSocket, @MessageBody() id: unknown): Promise<Ack> {
    const result = await this.messagesService.unsend(socket.data.username, id);
    if (!result.ok) return result;
    this.toRoom(result.roomId).emit('messageUnsent', { roomId: result.roomId, id: result.id });
    return { ok: true };
  }

  /** Tells the Room's other Users that this User is typing. A refused request gets no answer: there is nothing to retry. */
  @SubscribeMessage('typing')
  async typing(@ConnectedSocket() socket: ChatSocket, @MessageBody() roomId: unknown) {
    const { username } = socket.data;
    if (typeof roomId !== 'string' || !(await this.messagesService.isInRoom(username, roomId))) return;
    this.toRoom(roomId).except(`user:${username.toLowerCase()}`).emit('typing', { roomId, username });
  }

  /** `groupDeleted` stops the reply: it can outlast its Group, and a new Group with the name mustn't get the rest of it. */
  private async answerAsBot(roomId: string, asker: string, groupDeleted: () => boolean) {
    if (this.botAnswering.has(roomId) || this.botAnswering.has(asker)) return;
    this.botAnswering.add(roomId).add(asker);
    // Nest doesn't see this promise, so an error here would be an unhandled rejection that stops the whole server.
    try {
      // shortcut: read once, so a Message unsent while bot is answering still reaches the model this time; re-read before the main AI call if that matters.
      const history = await this.messagesService.recent(roomId, BOT_CONTEXT_MESSAGES);
      const reply = await this.bot.reply(history, (text) => {
        if (!groupDeleted()) this.toRoom(roomId).emit('botChunk', { roomId, text });
      });
      const message = await this.messagesService.saveBotReply(roomId, reply, groupDeleted);
      if (message) this.toRoom(roomId).emit('message', message);
    } catch (err) {
      this.logger.error(err);
      if (groupDeleted()) return;
      // Not saved, since the database may be what failed. It still ends the streaming bubble.
      const createdAt = new Date().toISOString();
      this.toRoom(roomId).emit('message', { roomId, sender: BOT_NAME, text: BOT_UNAVAILABLE, createdAt });
    } finally {
      this.botAnswering.delete(roomId);
      this.botAnswering.delete(asker);
    }
  }

  /** Every Client in the Room: a Group's Members through its Socket.IO room, or both Users of a Private Room. */
  private toRoom(roomId: string) {
    // Every Client of every Member is in the Group's Socket.IO room, named by its Room id (GroupsGateway).
    if (groupKeyOf(roomId) !== undefined) return this.server.to(roomId);
    const [userA, userB] = roomId.split(':');
    return this.server.to(`user:${userA}`).to(`user:${userB}`);
  }
}
