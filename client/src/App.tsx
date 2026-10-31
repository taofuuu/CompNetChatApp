import type { AuthMode, ClientToServerEvents, GroupSummary, HandshakeAuth, Message, ServerToClientEvents } from '@compnet/shared';
import { type FormEvent, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { Groups } from './Groups';
import { privateRoomId } from './private-room';
import { Room } from './Room';

type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function App() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [socket, setSocket] = useState<ChatSocket>();
  const [onlineList, setOnlineList] = useState<string[]>();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [activeRoom, setActiveRoom] = useState<{ roomId: string; title: string } | null>(null);
  const activeRoomId = useRef('');
  const [messagesByRoom, setMessagesByRoom] = useState<Record<string, Message[]>>({});
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
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
      if (activeRoomId.current) {
        socket.emitWithAck('loadMessages', activeRoomId.current).then((r) => {
          if (r.ok) {
            setMessagesByRoom((prev) => ({ ...prev, [r.roomId]: r.messages }));
          }
        });
      }
    });
    socket.on('onlineList', setOnlineList);
    // Listened for here, not in <Groups>, so the list sent right after connecting isn't missed.
    socket.on('groupList', setGroups);
    socket.on('message', (message: Message) => {
      setMessagesByRoom((prev) => ({
        ...prev,
        [message.roomId]: [...(prev[message.roomId] || []), message],
      }));
      if (message.roomId !== activeRoomId.current) {
        setUnreadCounts((prev) => ({
          ...prev,
          [message.roomId]: (prev[message.roomId] || 0) + 1,
        }));
      }
    });
    socket.on('connect_error', (err) => {
      setError(err.message);
      if (socket.active) return; // a network problem: Socket.IO keeps retrying by itself
      // Refused by the server: back to the login form.
      setConnecting(false);
      setSocket(undefined);
      setOnlineList(undefined);
    });
  }

  async function openPrivateRoom(targetUser: string) {
    if (!socket) return;
    try {
      const result = await socket.timeout(10_000).emitWithAck('openPrivateRoom', targetUser);
      if (result.ok) {
        setError('');
        activeRoomId.current = result.roomId;
        setActiveRoom({ roomId: result.roomId, title: targetUser });
        setMessagesByRoom((prev) => ({
          ...prev,
          [result.roomId]: result.messages,
        }));
        setUnreadCounts((prev) => ({
          ...prev,
          [result.roomId]: 0,
        }));
      } else {
        setError(result.error);
      }
    } catch {
      setError('No answer from the server. Try again.');
    }
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
    <main className="app-container">
      <h1>Chat App</h1>
      {error && <p role="alert">{error}</p>}
      <div className="chat-layout">
        <aside className="sidebar">
          <h2>Online</h2>
          <ul className="online-list">
            {onlineList.map((name) => {
              const isMe = name.toLowerCase() === me;
              if (isMe) {
                return (
                  <li key={name} className="online-user-item">
                    <span>{name} (you)</span>
                  </li>
                );
              }
              const roomId = privateRoomId(me, name);
              const unread = unreadCounts[roomId] || 0;
              const isSelected = activeRoom?.roomId === roomId;
              return (
                <li key={name} className="online-user-item">
                  <button
                    type="button"
                    className={`user-button ${isSelected ? 'active' : ''}`}
                    onClick={() => openPrivateRoom(name)}
                  >
                    {name}
                    {unread > 0 && <span className="unread-count"> ({unread})</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <Groups socket={socket} groups={groups} me={me} />
        </aside>

        <section className="main-panel">
          {activeRoom ? (
            <Room
              key={activeRoom.roomId}
              socket={socket}
              roomId={activeRoom.roomId}
              title={activeRoom.title}
              messages={messagesByRoom[activeRoom.roomId] || []}
              me={me}
            />
          ) : (
            <div className="empty-panel">
              <p>Select an Online User to open a Private Room.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
