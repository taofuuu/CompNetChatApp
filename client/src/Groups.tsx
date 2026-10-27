import type { Ack, ClientToServerEvents, GroupSummary, ServerToClientEvents } from '@compnet/shared';
import { type FormEvent, useState } from 'react';
import type { Socket } from 'socket.io-client';

interface Props {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  groups: GroupSummary[];
  /** The viewer's lowercase username. */
  me: string;
}

/** The Create Group form and the Group list, each Group with its Members and a Join button if you aren't one. */
export function Groups({ socket, groups, me }: Props) {
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

  return (
    <section>
      <h2>Groups</h2>
      <form onSubmit={create}>
        <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Group name" />{' '}
        <button disabled={busy}>Create Group</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <ul>
        {groups.map((group) => (
          <li key={group.name}>
            <strong>{group.name}</strong>
            {!group.members.some((member) => member.toLowerCase() === me) && (
              <>
                {' '}
                <button disabled={busy} onClick={() => send('joinGroup', group.name)}>
                  Join
                </button>
              </>
            )}
            <br />
            <small>Members: {group.members.join(', ')}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}
