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
import { groupRoomId } from './group-room';
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
      // Joining a room after the disconnect has cleaned up would leave this socket in it for good.
      if (!socket.connected) return;
      // Into the Socket.IO room of every Group this User is a Member of, so their Group Messages reach it (R11).
      // A Group Message sent while the list was being read isn't received live, but its Room's history has it.
      const me = socket.data.username.toLowerCase();
      for (const group of groups) {
        if (group.members.some((member) => member.toLowerCase() === me)) void socket.join(groupRoomId(group.name));
      }
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
    if (result.ok) {
      this.addToGroupRoom(socket.data.username, name as string);
      await this.sendGroupList();
    }
    return result;
  }

  @SubscribeMessage('joinGroup')
  async joinGroup(@ConnectedSocket() socket: ChatSocket, @MessageBody() name: unknown): Promise<Ack> {
    // Who joins always comes from the connection, never from the payload, so nobody can add someone else (R10).
    const result = await this.groups.join(name, socket.data.username);
    if (result.ok) {
      this.addToGroupRoom(socket.data.username, name as string);
      await this.announce(name as string, `${socket.data.username} joined the Group`);
      await this.sendGroupList();
    }
    return result;
  }

  /** Saves an Announcement, then shows it to every Client of every Member. Saved before the acknowledgement, so the history the Client loads next has it. */
  private async announce(groupName: string, text: string) {
    const roomId = groupRoomId(groupName);
    this.server.to(roomId).emit('announcement', await this.groups.announce(roomId, text));
  }

  /**
   * Puts every Client of the new Member, not just the one that asked, into the Group's Socket.IO room (R11).
   * Done before the acknowledgement, so once the Client hears it's a Member, it receives every new Message.
   * Relies on the `user:` room each Client joins on connect (MessagesGateway).
   */
  private addToGroupRoom(username: string, groupName: string) {
    this.server.in(`user:${username.toLowerCase()}`).socketsJoin(groupRoomId(groupName));
  }

  private async sendGroupList() {
    const read = ++this.latest;
    const groups = await this.groups.list();
    if (read === this.latest) this.server.emit('groupList', groups);
  }
}
