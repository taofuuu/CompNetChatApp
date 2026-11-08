import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { VoteKick, VoteOutcome } from '@compnet/shared';
import { groupRoomId } from './group-room';

/** How long Members have to vote. */
const VOTE_KICK_MS = 30_000;

export interface RunningVote {
  group: string;
  roomId: string;
  starter: string;
  target: string;
  /** How many Members can vote, fixed when the vote starts. */
  voters: number;
  yes: number;
  /** The lowercase names of the voters who can still vote. */
  waitingFor: Set<string>;
  /** When the vote runs out, by the server's clock. */
  endsAt: number;
  timer: NodeJS.Timeout;
  /** Set once the result can't change, while it shows before taking effect. */
  outcome?: VoteOutcome;
}

/**
 * The Vote Kicks running right now, at most one per Group. Knows nothing about sockets or the database: the gateway does what a result means.
 * In memory, so a restart drops a running vote.
 */
@Injectable()
export class VoteKicksService implements OnModuleDestroy {
  /** Every running vote, by its Group's Room id. */
  private readonly votes = new Map<string, RunningVote>();
  /** How long a result shows on every Member's banner before it takes effect. Tests set it to 0. */
  resultHoldMs = 3_000;

  onModuleDestroy() {
    for (const { timer } of this.votes.values()) clearTimeout(timer);
  }

  /** The vote running in the Group with this Room id, if there is one. */
  runningIn(roomId: string) {
    return this.votes.get(roomId);
  }

  running() {
    return [...this.votes.values()];
  }

  /** Starts a vote with `starter`'s yes counted. Once its time runs out, silence counts as no and `onTimeUp` is called. Undefined if the Group already has one. */
  start(group: string, target: string, starter: string, otherVoters: string[], onTimeUp: (vote: RunningVote) => void): RunningVote | undefined {
    const roomId = groupRoomId(group);
    if (this.votes.has(roomId)) return undefined;
    const vote: RunningVote = {
      group,
      roomId,
      starter,
      target,
      voters: otherVoters.length + 1,
      yes: 1,
      waitingFor: new Set(otherVoters),
      endsAt: Date.now() + VOTE_KICK_MS,
      timer: setTimeout(() => {
        vote.waitingFor.clear();
        onTimeUp(vote);
      }, VOTE_KICK_MS),
    };
    this.votes.set(roomId, vote);
    return vote;
  }

  /** Counts `username`'s one vote in the Group named `name`, however many Clients they have. Undefined if they have none to cast. */
  cast(name: unknown, username: string, yes: boolean): RunningVote | undefined {
    const vote = typeof name === 'string' ? this.votes.get(groupRoomId(name)) : undefined;
    if (vote?.outcome || !vote?.waitingFor.delete(username.toLowerCase())) return undefined;
    if (yes) vote.yes++;
    return vote;
  }

  /** Fixes `vote`'s result at once, and resolves once it has shown. The vote keeps its Group meanwhile, so no new one starts on top of it. */
  hold(vote: RunningVote, outcome: VoteOutcome) {
    vote.outcome = outcome;
    clearTimeout(vote.timer);
    return new Promise((resolve) => setTimeout(resolve, this.resultHoldMs));
  }

  end(vote: RunningVote) {
    clearTimeout(vote.timer);
    // A vote ended early, its target gone, may have a newer vote in its place by the time its hold is up.
    if (this.votes.get(vote.roomId) === vote) this.votes.delete(vote.roomId);
  }
}

/** How `vote` ended, or undefined while its result can still change. A strict majority of voters passes. */
export function outcomeOf({ voters, yes, waitingFor }: RunningVote): VoteOutcome | undefined {
  const needed = Math.floor(voters / 2) + 1;
  if (yes >= needed) return 'passed';
  if (yes + waitingFor.size < needed) return 'failed';
  return undefined;
}

/** A vote as its Group's Members see it. */
export function toSharedVote({ roomId, group, starter, target, voters, yes, waitingFor, endsAt, outcome }: RunningVote): VoteKick {
  return { roomId, group, starter, target, voters, yes, waitingFor: [...waitingFor], msLeft: endsAt - Date.now(), ...(outcome && { outcome }) };
}
