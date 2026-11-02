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
import { groupKeyOf } from '../groups/group-room';
import type { SocketData } from '../socket-data';
import { MessagesService } from './messages.service';

type ChatServer = Server<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>;
type ChatSocket = Socket<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>;

// ADR-0001: WebSocket only.
@WebSocketGateway({ transports: ['websocket'] })
export class MessagesGateway implements OnGatewayConnection {
  @WebSocketServer() private server: ChatServer;

  constructor(private readonly messagesService: MessagesService) {}

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
      const { roomId } = result.message;
      if (groupKeyOf(roomId) !== undefined) {
        // Every Client of every Member is in the Group's Socket.IO room, named by its Room id (GroupsGateway).
        this.server.to(roomId).emit('message', result.message);
      } else {
        const parts = roomId.split(':');
        this.server.to(`user:${parts[0]}`).to(`user:${parts[1]}`).emit('message', result.message);
      }
      return { ok: true };
    }
    return { ok: false, error: result.error };
  }
}
