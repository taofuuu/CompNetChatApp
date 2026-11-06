import type { VoteKick } from '@compnet/shared';
import { useEffect, useState } from 'react';
import { useSecondsLeft } from './seconds-left';

/** A running Vote Kick, with when it ends on the `performance.now()` clock. */
export type LiveVoteKick = VoteKick & { endsAt: number };

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
  const noes = vote.voters - vote.yes - vote.waitingFor.length;

  async function cast(yes: boolean) {
    setBusy(true);
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
    <aside className="vote-panel enter" aria-label={`Vote Kick in ${vote.group}`}>
      <header>
        <p role="status">Kick {vote.target}?</p>
        <span className="vote-countdown" role="timer" aria-label={`${secondsLeft} seconds left`}>
          {secondsLeft}s
        </span>
      </header>
      <small>
        Started by {vote.starter} in {vote.group}
      </small>
      {vote.waitingFor.includes(me) ? (
        <div className="vote-answers">
          <button type="button" className="button" disabled={busy} aria-keyshortcuts={hasKeys ? 'F1' : undefined} onClick={() => cast(true)}>
            {hasKeys && <kbd>F1</kbd>} Yes {vote.yes}
          </button>
          <button type="button" className="button button-quiet" disabled={busy} aria-keyshortcuts={hasKeys ? 'F2' : undefined} onClick={() => cast(false)}>
            {hasKeys && <kbd>F2</kbd>} No {noes}
          </button>
        </div>
      ) : (
        <div className="vote-answers">
          <span>Yes {vote.yes}</span>
          <span>No {noes}</span>
        </div>
      )}
    </aside>
  );
}
