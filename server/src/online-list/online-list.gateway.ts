import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { HandshakeAuth, ServerToClientEvents } from '@compnet/shared';
import type { DefaultEventsMap, Server, Socket } from 'socket.io';
import { UsersService } from '../users/users.service';
import { OnlineListService } from './online-list.service';

/** What the server remembers about a connected Client: the User it logged in as, by their stored username. */
interface SocketData {
  username: string;
}

type ChatServer = Server<DefaultEventsMap, ServerToClientEvents, DefaultEventsMap, SocketData>;
type ChatSocket = Socket<DefaultEventsMap, ServerToClientEvents, DefaultEventsMap, SocketData>;

// ADR-0001: WebSocket only, never HTTP long-polling.
@WebSocketGateway({ transports: ['websocket'] })
export class OnlineListGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private server: ChatServer;

  constructor(
    private readonly onlineList: OnlineListService,
    private readonly users: UsersService,
  ) {}

  afterInit(server: ChatServer) {
    // Runs during the handshake: calling next with an Error refuses the connection, and the Client gets its message.
    // Every path calls next exactly once: the try only awaits, and next is called after it, never inside it.
    server.use(async (socket, next) => {
      const auth = socket.handshake.auth as Partial<Record<keyof HandshakeAuth, unknown>>;
      // Anything that isn't a string counts as empty, so the service's rules refuse it with their usual reason.
      const username = typeof auth.username === 'string' ? auth.username : '';
      const password = typeof auth.password === 'string' ? auth.password : '';
      let name: string;
      try {
        if (auth.mode === 'register') name = await this.users.register(username, password);
        else if (auth.mode === 'login') name = await this.users.logIn(username, password);
        else throw new Error('Choose Register or Log in.');
      } catch (err) {
        return next(err instanceof Error ? err : new Error(String(err)));
      }
      socket.data = { username: name };
      next();
    });
  }

  handleConnection(socket: ChatSocket) {
    this.onlineList.addClient(socket.data.username);
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
