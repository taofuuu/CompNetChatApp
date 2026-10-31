import type { AuthMode, ClientToServerEvents, GroupSummary, HandshakeAuth, ServerToClientEvents } from '@compnet/shared';
import { type FormEvent, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { Groups } from './Groups';

type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function App() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [socket, setSocket] = useState<ChatSocket>();
  const [onlineList, setOnlineList] = useState<string[]>();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [error, setError] = useState('');

  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Which button sent the form; pressing Enter counts as the first one, Log in.
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const mode = (submitter?.value ?? 'login') as AuthMode;
    setConnecting(true);
    const auth: HandshakeAuth = { mode, username, password };
    // ADR-0001: WebSocket only. The page's own origin: NestJS in production, Vite's proxy in development.
    const socket: ChatSocket = io({ transports: ['websocket'], auth });
    setSocket(socket);
    socket.on('connect', () => {
      setError('');
      // The account exists now: a reconnect after a network drop logs in rather than registering again.
      socket.auth = { ...auth, mode: 'login' };
    });
    socket.on('onlineList', setOnlineList);
    // Listened for here, not in <Groups>, so the list sent right after connecting isn't missed.
    socket.on('groupList', setGroups);
    socket.on('connect_error', (err) => {
      setError(err.message);
      if (socket.active) return; // a network problem: Socket.IO keeps retrying by itself
      // Refused by the server: back to the login form.
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
          <label>
            Password{' '}
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>{' '}
          <button value="login" disabled={connecting}>
            Log in
          </button>{' '}
          <button value="register" disabled={connecting}>
            Register
          </button>
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
