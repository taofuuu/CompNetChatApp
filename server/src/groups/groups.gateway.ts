import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Ack, ClientToServerEvents, GroupSummary, KickBlock, LeaveGroupAck, ServerToClientEvents } from '@compnet/shared';
import type { DefaultEventsMap, Server, Socket } from 'socket.io';
import type { SocketData } from '../socket-data';
import { groupRoomId } from './group-room';
import { GroupsService } from './groups.service';
import { outcomeOf, type RunningVote, toSharedVote, VoteKicksService } from './vote-kicks.service';

type ChatServer = Server<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>;
type ChatSocket = Socket<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>;

// ADR-0001: WebSocket only. The handshake check that sets socket.data lives in OnlineListGateway; every gateway shares it.
@WebSocketGateway({ transports: ['websocket'] })
export class GroupsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private server: ChatServer;

  private readonly logger = new Logger(GroupsGateway.name);
  /** Counts Group list broadcasts, so a slow read that finishes after a newer one isn't sent, and a connecting Client notices the Groups changed while it read them. */
  private latest = 0;

  constructor(
    private readonly groups: GroupsService,
    private readonly voteKicks: VoteKicksService,
  ) {}

  async handleConnection(socket: ChatSocket) {
    // Nest ignores this promise, so an error here would be an unhandled rejection that stops the whole server.
    try {
      // Read again if the Groups changed meanwhile: with an old list, a Client of a User who just left would stay in the Group's Socket.IO room for good.
      let started: number;
      let groups: GroupSummary[];
      let blocks: KickBlock[];
      do {
        started = this.latest;
        [groups, blocks] = await Promise.all([this.groups.list(), this.groups.kickBlocksOf(socket.data.username)]);
      } while (started !== this.latest);
      // Joining a room after the disconnect has cleaned up would leave this socket in it for good.
      if (!socket.connected) return;
      // Into the Socket.IO room of every Group this User is a Member of, so their Group Messages reach it (R11).
      // A Group Message sent while the list was being read isn't received live, but its Room's history has it.
      const me = socket.data.username.toLowerCase();
      for (const group of groups) {
        if (!group.members.some((member) => member.toLowerCase() === me)) continue;
        const roomId = groupRoomId(group.name);
        void socket.join(roomId);
        // In the same tick as joining the room, so this and every later update reach it, and nothing runs in between.
        const vote = this.voteKicks.runningIn(roomId);
        if (vote) socket.emit('voteKick', toSharedVote(vote));
      }
      socket.emit('kickBlocks', blocks);
      socket.emit('groupList', groups);
    } catch (err) {
      this.logger.error(err);
    }
  }

  handleDisconnect(socket: ChatSocket) {
    const key = socket.data.username.toLowerCase();
    // Their `user:` room empties with their last Client, whichever gateway hears of it first: the Online List may not know yet.
    if (this.server.sockets.adapter.rooms.has(`user:${key}`)) return;
    for (const vote of this.voteKicks.running()) {
      if (vote.waitingFor.delete(key)) this.settleUnawaited(vote);
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
      // After the list, because a Client forgets the vote of a Group the list says it isn't in.
      const vote = this.voteKicks.runningIn(groupRoomId(name as string));
      if (vote) this.server.to(`user:${socket.data.username.toLowerCase()}`).emit('voteKick', toSharedVote(vote));
    }
    return result;
  }

  @SubscribeMessage('leaveGroup')
  async leaveGroup(@ConnectedSocket() socket: ChatSocket, @MessageBody() payload: unknown): Promise<LeaveGroupAck> {
    const { name, confirmed } = (payload ?? {}) as { name?: unknown; confirmed?: unknown };
    // Who leaves always comes from the connection, never from the payload, so nobody can remove someone else.
    const result = await this.groups.leave(name, socket.data.username, confirmed === true);
    if (result.ok) {
      await this.removeFromGroupRoom(socket.data.username, name as string);
      if (!result.deleted) await this.announce(name as string, `${socket.data.username} left the Group`);
      await this.memberGone(socket.data.username, name as string);
    }
    return result;
  }

  @SubscribeMessage('kickMember')
  async kickMember(@ConnectedSocket() socket: ChatSocket, @MessageBody() payload: unknown): Promise<Ack> {
    const { name, target } = (payload ?? {}) as { name?: unknown; target?: unknown };
    // Who kicks always comes from the connection, never from the payload.
    const result = await this.groups.kick(name, target, socket.data.username);
    if (!result.ok) return result;
    // Offline as they are, a Client of theirs may be connecting right now.
    await this.removeFromGroupRoom(result.kicked, name as string);
    await this.announce(name as string, `${socket.data.username} kicked ${result.kicked}`);
    this.server.to(`user:${result.kicked.toLowerCase()}`).emit('kickBlocks', await this.groups.kickBlocksOf(result.kicked));
    await this.memberGone(result.kicked, name as string);
    return { ok: true };
  }

  @SubscribeMessage('startVoteKick')
  async startVoteKick(@ConnectedSocket() socket: ChatSocket, @MessageBody() payload: unknown): Promise<Ack> {
    const { name, target } = (payload ?? {}) as { name?: unknown; target?: unknown };
    // Who starts it always comes from the connection, never from the payload.
    const check = await this.groups.checkVoteKick(name, target, socket.data.username);
    if (!check.ok) return check;
    const vote = this.voteKicks.start(check.group, check.target, socket.data.username, check.otherVoters, (timedOut) => this.settleUnawaited(timedOut));
    if (!vote) return { ok: false, error: 'A vote is already running in this Group.' };
    this.server.to(vote.roomId).emit('voteKick', toSharedVote(vote));
    return { ok: true };
  }

  @SubscribeMessage('castVote')
  async castVote(@ConnectedSocket() socket: ChatSocket, @MessageBody() payload: unknown): Promise<Ack> {
    const { name, yes } = (payload ?? {}) as { name?: unknown; yes?: unknown };
    // Who votes always comes from the connection, never from the payload.
    const vote = this.voteKicks.cast(name, socket.data.username, yes === true);
    if (!vote) return { ok: false, error: 'You have no vote to cast in this Group.' };
    await this.settle(vote);
    return { ok: true };
  }

  /** Ends `vote` if its result can't change, and otherwise tells its Group how it stands. */
  private async settle(vote: RunningVote) {
    const { group, roomId, starter, target, yes, voters } = vote;
    const outcome = outcomeOf(vote);
    if (!outcome) return void this.server.to(roomId).emit('voteKick', toSharedVote(vote));
    this.voteKicks.end(vote);
    this.server.to(roomId).emit('voteKickEnded', roomId);
    if (outcome === 'failed') {
      // Leaving cancels a vote on them, even in the moment before it hears: "left the Group" is the only Announcement then.
      if (await this.groups.isMember(group.toLowerCase(), target)) await this.announce(group, `The vote to kick ${target} failed`);
      return;
    }
    // shortcut: a pass that would leave the Group empty, in a race with its last voter leaving, ends with no Announcement; say so if Users hit this.
    if (!(await this.groups.voteOut(group, target))) return;
    await this.removeFromGroupRoom(target, group);
    await this.announce(group, `${target} was voted out, ${yes} of ${voters} votes, started by ${starter}`);
    const theirClients = this.server.to(`user:${target.toLowerCase()}`);
    theirClients.emit('kickBlocks', await this.groups.kickBlocksOf(target));
    // shortcut: a target offline right now never hears this: reconnecting shows the Room closed and the Join countdown, with no banner; replay it on connect if Users hit this.
    theirClients.emit('votedOut', group);
    // A new vote may have started before they were out, on them or with them as a voter.
    await this.memberGone(target, group);
  }

  /** `settle` where nobody awaits it, so an error would be an unhandled rejection that stops the whole server. */
  private settleUnawaited(vote: RunningVote) {
    this.settle(vote).catch((err: unknown) => this.logger.error(err));
  }

  /** What a Member no longer being in the Group means for its vote: a vote on them is cancelled, and otherwise, if they hadn't voted, they count as no. */
  private async memberGone(username: string, groupName: string) {
    const vote = this.voteKicks.runningIn(groupRoomId(groupName));
    if (!vote) return;
    const key = username.toLowerCase();
    if (vote.target.toLowerCase() === key) {
      this.voteKicks.end(vote);
      this.server.to(vote.roomId).emit('voteKickEnded', vote.roomId);
    } else if (vote.waitingFor.delete(key)) {
      await this.settle(vote);
    }
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

  /**
   * Takes every Client of someone who is no longer a Member out of the Group's Socket.IO room, so the Announcement goes to the remaining Members only.
   * The list goes out before that Announcement: sendGroupList counts the change at once, in the same tick as leaving the room, so a Client connecting now reads the list again.
   */
  private async removeFromGroupRoom(username: string, groupName: string) {
    this.server.in(`user:${username.toLowerCase()}`).socketsLeave(groupRoomId(groupName));
    await this.sendGroupList();
  }

  private async sendGroupList() {
    const read = ++this.latest;
    const groups = await this.groups.list();
    if (read === this.latest) this.server.emit('groupList', groups);
  }
}
