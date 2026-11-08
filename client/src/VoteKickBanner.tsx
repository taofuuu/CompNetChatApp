import type { VoteKick } from '@compnet/shared';
import { useEffect, useState } from 'react';
import { useSecondsLeft } from './seconds-left';

/** A running Vote Kick, with when it ends on the `performance.now()` clock. */
export type LiveVoteKick = VoteKick & { endsAt: number };

/** How long a Vote Kick runs. Matches VOTE_KICK_MS on the server. */
const VOTE_KICK_SECONDS = 30;

// role="img" so screen readers still hear "Yes" and "No" in place of the marks.
const YES = (
  <span className="vote-mark" role="img" aria-label="Yes">
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  </span>
);
const NO = (
  <span className="vote-mark" role="img" aria-label="No">
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 5l6 6M11 5l-6 6" />
    </svg>
  </span>
);

interface Props {
  vote: LiveVoteKick;
  /** The viewer's lowercase username. */
  me: string;
  /** Whether F1 and F2 act on this vote. Only one vote has them at a time. */
  hasKeys: boolean;
  onVote: (yes: boolean) => Promise<void>;
}

/**
 * A running Vote Kick, floating over whichever Room is open.
 * Only a voter who hasn't voted is in `waitingFor`, so the target and the starter never get buttons.
 */
export function VoteKickBanner({ vote, me, hasKeys, onVote }: Props) {
  const secondsLeft = useSecondsLeft(vote.endsAt);
  // Until the server answers, so a double press can't be refused as a second vote. Its update then takes the buttons away.
  const [busy, setBusy] = useState(false);
  // The starter's yes is counted for them. shortcut: a reload forgets anyone else's vote, so the line goes until the next vote.
  const [myVote, setMyVote] = useState<boolean | undefined>(me === vote.starter ? true : undefined);
  const noes = vote.voters - vote.yes - vote.waitingFor.length;
  const { outcome } = vote;
  const canVote = !outcome && vote.waitingFor.includes(me);
  // Frozen at the moment the result came, while it shows.
  const shownSeconds = outcome ? Math.max(Math.ceil(vote.msLeft / 1000), 0) : secondsLeft;

  async function cast(yes: boolean) {
    setBusy(true);
    // Before the answer: a deciding vote's answer waits out the seconds its result shows. A refusal keeps the buttons, which hide this.
    setMyVote(yes);
    await onVote(yes);
    setBusy(false);
  }

  // On the window, so the keys work from the text box too. Only while there is a vote to cast, so F1 opens the browser's help the rest of the time.
  useEffect(() => {
    if (!hasKeys) return;
    function press(event: KeyboardEvent) {
      if (event.key !== 'F1' && event.key !== 'F2') return;
      event.preventDefault();
      // Holding a key down repeats it, and a popup is asking something else.
      if (event.repeat || busy || document.querySelector('dialog[open]')) return;
      void cast(event.key === 'F1');
    }
    window.addEventListener('keydown', press);
    return () => window.removeEventListener('keydown', press);
  });

  return (
    <aside className={`vote-panel enter ${outcome ? `vote-${outcome}` : ''}`} aria-label={`Vote Kick in ${vote.group}`}>
      {outcome && (
        <p className={`vote-title ${outcome === 'passed' ? 'vote-yes' : 'vote-no'}`}>
          {outcome === 'passed' ? YES : NO} Vote {outcome === 'passed' ? 'Passed' : 'Failed'}!
        </p>
      )}
      <div className="vote-body">
        <div>
          <p role="status">
            {outcome === 'passed' ? `Kicking ${vote.target}` : outcome === 'failed' ? `${vote.target} stays` : `Kick ${vote.target}?`}
          </p>
          <small>
            Started by {vote.starter} in {vote.group}
          </small>
        </div>
        {canVote ? (
          <div className="vote-answers">
            <button type="button" className="vote-yes" disabled={busy} aria-keyshortcuts={hasKeys ? 'F1' : undefined} onClick={() => cast(true)}>
              {YES} {vote.yes}
            </button>
            <button type="button" className="vote-no" disabled={busy} aria-keyshortcuts={hasKeys ? 'F2' : undefined} onClick={() => cast(false)}>
              {NO} {noes}
            </button>
          </div>
        ) : (
          <div className="vote-answers">
            <span className="vote-yes">
              {YES} {vote.yes}
            </span>
            <span className="vote-no">
              {NO} {noes}
            </span>
          </div>
        )}
      </div>
      {canVote && hasKeys && (
        <footer>
          <span>
            <kbd className="vote-yes">F1</kbd> for YES
          </span>
          <span>
            <kbd className="vote-no">F2</kbd> for NO
          </span>
        </footer>
      )}
      {!canVote && myVote !== undefined && (
        <footer>
          <span />
          <span>
            You voted: <b className={myVote ? 'vote-yes' : 'vote-no'}>{myVote ? 'YES' : 'NO'}</b>
          </span>
        </footer>
      )}
      <div className="vote-timer" role="timer" aria-label={outcome ? 'Voting is over' : `${shownSeconds} seconds left`}>
        <span style={{ width: `${(shownSeconds / VOTE_KICK_SECONDS) * 100}%` }} />
      </div>
    </aside>
  );
}
