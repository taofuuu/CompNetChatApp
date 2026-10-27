import type { ClientToServerEvents, GroupSummary, HandshakeAuth, ServerToClientEvents } from '@compnet/shared';
import { type FormEvent, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { Groups } from './Groups';

type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// Shared by every tab in this browser, so they count as the same User.
// Not crypto.randomUUID(): it needs HTTPS, and the hotspot setup serves the page over plain HTTP.
const browserId: string = (localStorage.browserId ??= crypto.getRandomValues(new Uint32Array(4)).join('-'));

export function App() {
  const [username, setUsername] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [socket, setSocket] = useState<ChatSocket>();
  const [onlineList, setOnlineList] = useState<string[]>();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [error, setError] = useState('');

  function connect(event: FormEvent) {
    event.preventDefault();
    setConnecting(true);
    const auth: HandshakeAuth = { username, browserId };
    // ADR-0001: WebSocket only. The page's own origin: NestJS in production, Vite's proxy in development.
    const socket: ChatSocket = io({ transports: ['websocket'], auth });
    setSocket(socket);
    socket.on('connect', () => setError(''));
    socket.on('onlineList', setOnlineList);
    // Listened for here, not in <Groups>, so the list sent right after connecting isn't missed.
    socket.on('groupList', setGroups);
    socket.on('connect_error', (err) => {
      setError(err.message);
      if (socket.active) return; // a network problem: Socket.IO keeps retrying by itself
      // Refused by the server: back to the username form.
      setConnecting(false);
      setSocket(undefined);
      setOnlineList(undefined);
    });
  }

  if (!socket || !onlineList) {
    return (
      <main>
        <h1>Chat App</h1>
        <form onSubmit={connect}>
          <label>
            Username <input value={username} onChange={(event) => setUsername(event.target.value)} autoFocus />
          </label>{' '}
          <button disabled={connecting}>Connect</button>
        </form>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  }

  const me = username.trim().toLowerCase();
  return (
    <main>
      {error && <p role="alert">{error}</p>}
      <h2>Online</h2>
      <ul>
        {onlineList.map((name) => (
          <li key={name}>
            {name}
            {name.toLowerCase() === me && ' (you)'}
          </li>
        ))}
      </ul>
      <Groups socket={socket} groups={groups} me={me} />
    </main>
  );
}
