import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { HandshakeAuth, ServerToClientEvents } from '@compnet/shared';
import type { DefaultEventsMap, Server, Socket } from 'socket.io';
import { OnlineListService } from './online-list.service';

type ChatServer = Server<DefaultEventsMap, ServerToClientEvents, DefaultEventsMap, HandshakeAuth>;
type ChatSocket = Socket<DefaultEventsMap, ServerToClientEvents, DefaultEventsMap, HandshakeAuth>;

// ADR-0001: WebSocket only, never HTTP long-polling.
@WebSocketGateway({ transports: ['websocket'] })
export class OnlineListGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private server: ChatServer;

  constructor(private readonly onlineList: OnlineListService) {}

  afterInit(server: ChatServer) {
    // Runs during the handshake: calling next with an Error refuses the connection, and the Client gets its message.
    server.use((socket, next) => {
      const { username, browserId } = socket.handshake.auth as Partial<HandshakeAuth>;
      const name = typeof username === 'string' ? username.trim() : '';
      if (!name) return next(new Error('Enter a username.'));
      if (typeof browserId !== 'string' || !browserId) return next(new Error('Missing browser id.'));
      const takenBy = this.onlineList.takenBy(name, browserId);
      if (takenBy) return next(new Error(`${takenBy} is already Online.`));
      socket.data = { username: name, browserId };
      next();
    });
  }

  handleConnection(socket: ChatSocket) {
    this.onlineList.addClient(socket.data.username, socket.data.browserId);
    this.sendOnlineList();
  }

  handleDisconnect(socket: ChatSocket) {
    this.onlineList.removeClient(socket.data.username);
    this.sendOnlineList();
  }

  private sendOnlineList() {
    this.server.emit('onlineList', this.onlineList.names());
  }
}
