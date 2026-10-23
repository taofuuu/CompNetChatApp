import type { HandshakeAuth, ServerToClientEvents } from '@compnet/shared';
import { type FormEvent, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

// Shared by every tab in this browser, so they count as the same User.
// Not crypto.randomUUID(): it needs HTTPS, and the hotspot setup serves the page over plain HTTP.
const browserId: string = (localStorage.browserId ??= crypto.getRandomValues(new Uint32Array(4)).join('-'));

export function App() {
  const [username, setUsername] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [onlineList, setOnlineList] = useState<string[]>();
  const [error, setError] = useState('');

  function connect(event: FormEvent) {
    event.preventDefault();
    setConnecting(true);
    const auth: HandshakeAuth = { username, browserId };
    // ADR-0001: WebSocket only. The page's own origin: NestJS in production, Vite's proxy in development.
    const socket: Socket<ServerToClientEvents> = io({ transports: ['websocket'], auth });
    socket.on('connect', () => setError(''));
    socket.on('onlineList', setOnlineList);
    socket.on('connect_error', (err) => {
      setError(err.message);
      if (socket.active) return; // a network problem: Socket.IO keeps retrying by itself
      // Refused by the server: back to the username form.
      setConnecting(false);
      setOnlineList(undefined);
    });
  }

  if (!onlineList) {
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
    </main>
  );
}
