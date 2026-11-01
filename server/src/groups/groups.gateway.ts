import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Ack, ClientToServerEvents, ServerToClientEvents } from '@compnet/shared';
import type { DefaultEventsMap, Server, Socket } from 'socket.io';
import type { SocketData } from '../socket-data';
import { GroupsService } from './groups.service';

type ChatServer = Server<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>;
type ChatSocket = Socket<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>;

// ADR-0001: WebSocket only. The handshake check that sets socket.data lives in OnlineListGateway; every gateway shares it.
@WebSocketGateway({ transports: ['websocket'] })
export class GroupsGateway implements OnGatewayConnection {
  @WebSocketServer() private server: ChatServer;

  private readonly logger = new Logger(GroupsGateway.name);
  /** Counts Group list reads, so a slow read that finishes after a newer one isn't sent and doesn't overwrite it. */
  private latest = 0;

  constructor(private readonly groups: GroupsService) {}

  async handleConnection(socket: ChatSocket) {
    // Nest ignores this promise, so an error here would be an unhandled rejection that stops the whole server.
    try {
      const started = this.latest;
      const groups = await this.groups.list();
      // A newer broadcast already reached this socket.
      if (started === this.latest) socket.emit('groupList', groups);
    } catch (err) {
      this.logger.error(err);
    }
  }

  // What these return is the acknowledgement the Client gets back.
  @SubscribeMessage('createGroup')
  async createGroup(@ConnectedSocket() socket: ChatSocket, @MessageBody() name: unknown): Promise<Ack> {
    const result = await this.groups.create(name, socket.data.username);
    if (result.ok) await this.sendGroupList();
    return result;
  }

  @SubscribeMessage('joinGroup')
  async joinGroup(@ConnectedSocket() socket: ChatSocket, @MessageBody() name: unknown): Promise<Ack> {
    // Who joins always comes from the connection, never from the payload, so nobody can add someone else (R10).
    const result = await this.groups.join(name, socket.data.username);
    if (result.ok) await this.sendGroupList();
    return result;
  }

  private async sendGroupList() {
    const read = ++this.latest;
    const groups = await this.groups.list();
    if (read === this.latest) this.server.emit('groupList', groups);
  }
}
