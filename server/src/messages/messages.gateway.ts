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
  HandshakeAuth,
  RoomMessagesAck,
  ServerToClientEvents,
} from '@compnet/shared';
import type { DefaultEventsMap, Server, Socket } from 'socket.io';
import { MessagesService } from './messages.service';

type ChatServer = Server<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, HandshakeAuth>;
type ChatSocket = Socket<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, HandshakeAuth>;

// ADR-0001: WebSocket only.
@WebSocketGateway({ transports: ['websocket'] })
export class MessagesGateway implements OnGatewayConnection {
  @WebSocketServer() private server: ChatServer;

  constructor(private readonly messagesService: MessagesService) {}

  handleConnection(socket: ChatSocket) {
    if (socket.data?.username) {
      socket.join(`user:${socket.data.username.toLowerCase()}`);
    }
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
      const parts = result.message.roomId.split(':');
      if (parts.length === 2) {
        this.server.to(`user:${parts[0]}`).to(`user:${parts[1]}`).emit('message', result.message);
      }
      return { ok: true };
    }
    return { ok: false, error: result.error };
  }
}
