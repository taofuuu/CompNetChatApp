import type { Ack, ClientToServerEvents, GroupSummary, ServerToClientEvents } from '@compnet/shared';
import { type FormEvent, useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { Banner } from './Banner';
import { groupRoomId } from './group-room';

interface Props {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  groups: GroupSummary[];
  /** The viewer's lowercase username. */
  me: string;
  /** The Room open in the main panel, if any. */
  activeRoomId?: string;
  unreadCounts: Record<string, number>;
  /** When each Group's block on the viewer ends, by Group name, on the `performance.now()` clock. */
  kickBlocks: Record<string, number>;
  /** Opens the Room of the Group named `name`. */
  onOpen: (name: string) => void;
}

interface JoinButtonProps {
  /** When the block on the viewer ends, on the `performance.now()` clock, if there is one. */
  blockedUntil?: number;
  busy: boolean;
  onJoin: () => void;
}

/** A Join button, disabled beside a live countdown while a Kick blocks the viewer. Give it a new `key` for each block, so it starts from the current time. */
function JoinButton({ blockedUntil = 0, busy, onJoin }: JoinButtonProps) {
  const [now, setNow] = useState(() => performance.now());
  const secondsLeft = Math.ceil((blockedUntil - now) / 1000);
  const blocked = secondsLeft > 0;

  useEffect(() => {
    if (!blocked) return;
    const timer = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(timer);
  }, [blocked]);

  return (
    <>
      {blocked && (
        <small className="join-countdown" role="timer" aria-label={`You can join again in ${secondsLeft} seconds`}>
          {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
        </small>
      )}
      <button className="join-button" disabled={busy || blocked} onClick={onJoin}>
        Join
      </button>
    </>
  );
}

/**
 * The Create Group form and the Group list, each Group with its Members.
 * A Group you're a Member of opens its Room when clicked; any other has a Join button, which also opens it.
 */
export function Groups({ socket, groups, me, activeRoomId, unreadCounts, kickBlocks, onOpen }: Props) {
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // The server enforces every rule; the page only shows its answer.
  async function send(event: 'createGroup' | 'joinGroup', name: string): Promise<Ack> {
    setBusy(true);
    try {
      // The timeout also ends the wait when the server throws, because then no answer ever comes.
      const result = await socket.timeout(10_000).emitWithAck(event, name);
      setError(result.ok ? '' : result.error);
      return result;
    } catch {
      // Disconnected or timed out: say so, and leave the buttons usable.
      setError('No answer from the server. Try again.');
      return { ok: false, error: '' };
    } finally {
      setBusy(false);
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if ((await send('createGroup', newName)).ok) setNewName('');
  }

  async function join(name: string) {
    if ((await send('joinGroup', name)).ok) onOpen(name);
  }

  return (
    <section>
      <h2>Groups</h2>
      <form className="group-form" onSubmit={create}>
        <input
          aria-label="Group name"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="Group name"
        />
        <button className="button button-quiet" disabled={busy}>
          Create Group
        </button>
      </form>
      <Banner text={error} />
      <ul className="group-list">
        {groups.map((group) => {
          const roomId = groupRoomId(group.name);
          const unread = unreadCounts[roomId] || 0;
          const isSelected = activeRoomId === roomId;
          return (
            <li key={group.name} className="enter">
              {group.members.some((member) => member.toLowerCase() === me) ? (
                <button
                  type="button"
                  className={`row row-button ${isSelected ? 'active' : ''}`}
                  aria-current={isSelected}
                  onClick={() => onOpen(group.name)}
                >
                  <strong>{group.name}</strong>
                  {unread > 0 && (
                    // The key restarts the pop on every new count.
                    <span key={unread} className="unread-count" aria-label={`${unread} unread`}>
                      {unread}
                    </span>
                  )}
                </button>
              ) : (
                <div className="row">
                  <strong>{group.name}</strong>
                  <JoinButton key={kickBlocks[group.name]} blockedUntil={kickBlocks[group.name]} busy={busy} onJoin={() => join(group.name)} />
                </div>
              )}
              <small className="group-members">Members: {group.members.join(', ')}</small>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
