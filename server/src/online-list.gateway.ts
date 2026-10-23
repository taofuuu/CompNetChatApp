import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { HandshakeAuth, ServerToClientEvents } from '@compnet/shared';
import type { DefaultEventsMap, Server, Socket } from 'socket.io';

type ChatServer = Server<DefaultEventsMap, ServerToClientEvents, DefaultEventsMap, HandshakeAuth>;
type ChatSocket = Socket<DefaultEventsMap, ServerToClientEvents, DefaultEventsMap, HandshakeAuth>;

// ADR-0001: WebSocket only, never HTTP long-polling.
@WebSocketGateway({ transports: ['websocket'] })
export class OnlineListGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private server: ChatServer;
  /** Every Online User, keyed by their lowercase name. */
  private readonly onlineUsers = new Map<string, { name: string; browserId: string; clients: number }>();

  afterInit(server: ChatServer) {
    // Runs during the handshake: calling next with an Error refuses the connection, and the Client gets its message.
    server.use((socket, next) => {
      const { username, browserId } = socket.handshake.auth as Partial<HandshakeAuth>;
      const name = typeof username === 'string' ? username.trim() : '';
      if (!name) return next(new Error('Enter a username.'));
      if (typeof browserId !== 'string' || !browserId) return next(new Error('Missing browser id.'));
      const user = this.onlineUsers.get(name.toLowerCase());
      // Only the browser that brought this User Online can add Clients to them.
      if (user && browserId !== user.browserId) return next(new Error(`${user.name} is already Online.`));
      socket.data = { username: user?.name ?? name, browserId };
      next();
    });
  }

  handleConnection(socket: ChatSocket) {
    const { username, browserId } = socket.data;
    const user = this.onlineUsers.get(username.toLowerCase());
    if (user) user.clients++;
    else this.onlineUsers.set(username.toLowerCase(), { name: username, browserId, clients: 1 });
    this.sendOnlineList();
  }

  handleDisconnect(socket: ChatSocket) {
    const key = socket.data.username.toLowerCase();
    const user = this.onlineUsers.get(key);
    if (user && --user.clients === 0) this.onlineUsers.delete(key);
    this.sendOnlineList();
  }

  private sendOnlineList() {
    this.server.emit('onlineList', [...this.onlineUsers.values()].map((user) => user.name));
  }
}
