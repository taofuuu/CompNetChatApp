import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Ack, ClientToServerEvents, HandshakeAuth, ServerToClientEvents } from '@compnet/shared';
import type { DefaultEventsMap, Server, Socket } from 'socket.io';
import { GroupsService } from './groups.service';

type ChatServer = Server<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, HandshakeAuth>;
type ChatSocket = Socket<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, HandshakeAuth>;

// ADR-0001: WebSocket only. The handshake check that sets socket.data lives in OnlineListGateway; every gateway shares it.
@WebSocketGateway({ transports: ['websocket'] })
export class GroupsGateway implements OnGatewayConnection {
  @WebSocketServer() private server: ChatServer;

  constructor(private readonly groups: GroupsService) {}

  async handleConnection(socket: ChatSocket) {
    socket.emit('groupList', await this.groups.list());
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
    this.server.emit('groupList', await this.groups.list());
  }
}
