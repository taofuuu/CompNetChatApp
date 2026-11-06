import type { VoteKick } from '@compnet/shared';
import { useSecondsLeft } from './seconds-left';

/** A running Vote Kick, with when it ends on the `performance.now()` clock. */
export type LiveVoteKick = VoteKick & { endsAt: number };

interface Props {
  vote: LiveVoteKick;
  /** The viewer's lowercase username. */
  me: string;
  busy: boolean;
  onVote: (yes: boolean) => void;
}

/** The running Vote Kick at the top of a Group's Room. Only a voter who hasn't voted is in `waitingFor`, so the target and the starter never get buttons. */
export function VoteKickBanner({ vote, me, busy, onVote }: Props) {
  const secondsLeft = useSecondsLeft(vote.endsAt);
  return (
    <div className="vote-banner">
      <p role="status">
        {vote.starter} wants to kick {vote.target}: {vote.yes} yes
      </p>
      <span className="vote-countdown" role="timer" aria-label={`${secondsLeft} seconds left`}>
        {secondsLeft}s
      </span>
      {vote.waitingFor.includes(me) && (
        <>
          <button type="button" className="button" disabled={busy} onClick={() => onVote(true)}>
            Yes
          </button>
          <button type="button" className="button button-quiet" disabled={busy} onClick={() => onVote(false)}>
            No
          </button>
        </>
      )}
    </div>
  );
}
