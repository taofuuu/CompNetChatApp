import type {
  AuthMode,
  ClientToServerEvents,
  GroupSummary,
  HandshakeAuth,
  Message,
  RoomMessagesAck,
  ServerToClientEvents,
} from '@compnet/shared';
import { type FormEvent, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { io, type Socket } from 'socket.io-client';
import { Banner } from './Banner';
import { groupRoomId } from './group-room';
import { Groups } from './Groups';
import { MemberPanel } from './MemberPanel';
import { privateRoomId } from './private-room';
import { BOT_NAME, Room } from './Room';

type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Longer than the server's limits on the bot's first word: past this, the server skipped the @bot. */
const BOT_PATIENCE_MS = 20_000;
/** How long a typing bubble lasts without news. Nobody says they stopped: they just stop saying they're typing. */
const TYPING_SHOWN_MS = 3_000;

/** Makes a state change as a View Transition, styled in styles.css, or plainly in a browser without them. */
function smoothly(update: () => void) {
  if (!document.startViewTransition) return update();
  // Rejects when the browser drops the animation, e.g. in a background tab. The update still happens.
  document.startViewTransition(() => flushSync(update)).ready.catch(() => {});
}

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
  /** The bot's reply so far, by Room: empty before its first word, undefined when it isn't answering. */
  const [botDrafts, setBotDrafts] = useState<Record<string, string | undefined>>({});
  /** The other Users typing right now, by Room. */
  const [typers, setTypers] = useState<Record<string, string[]>>({});
  const typingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [error, setError] = useState('');

  /** Shows or hides `username`'s typing bubble in `roomId`. Showing it again restarts its time. */
  function showTyping(roomId: string, username: string, isTyping: boolean) {
    const timer = `${roomId}/${username}`;
    clearTimeout(typingTimers.current.get(timer));
    typingTimers.current.delete(timer);
    if (isTyping) typingTimers.current.set(timer, setTimeout(() => showTyping(roomId, username, false), TYPING_SHOWN_MS));
    setTypers((prev) => {
      const names = prev[roomId] || [];
      if (isTyping === names.includes(username)) return prev;
      return { ...prev, [roomId]: isTyping ? [...names, username] : names.filter((name) => name !== username) };
    });
  }

  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Which button sent the form; pressing Enter counts as the first one, Log in.
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const mode = (submitter?.value ?? 'login') as AuthMode;
    setConnecting(true);
    const auth: HandshakeAuth = { mode, username, password };
    // ADR-0001: WebSocket only. The page's own origin: NestJS in production, Vite's proxy in development.
    const socket: ChatSocket = io({ transports: ['websocket'], auth });
    socket.on('connect', () => {
      setError('');
      // The account exists now: a reconnect after a network drop logs in rather than registering again.
      socket.auth = { ...auth, mode: 'login' };
      // A reply that finished while disconnected never sends its last Message; the history below has it.
      setBotDrafts({});
      if (activeRoomId.current) {
        socket.emitWithAck('loadMessages', activeRoomId.current).then((r) => {
          if (r.ok) {
            setMessagesByRoom((prev) => ({ ...prev, [r.roomId]: r.messages }));
          }
        });
      }
    });
    socket.on('disconnect', () => setError('Connection lost. Reconnecting…'));
    // The first list is what lets the chat screen in.
    let loggedIn = false;
    socket.on('onlineList', (names) => {
      if (loggedIn) return setOnlineList(names);
      loggedIn = true;
      smoothly(() => setOnlineList(names));
    });
    // Listened for here, not in <Groups>, so the list sent right after connecting isn't missed.
    socket.on('groupList', setGroups);
    socket.on('botChunk', ({ roomId, text }) => {
      setBotDrafts((prev) => ({ ...prev, [roomId]: (prev[roomId] ?? '') + text }));
    });
    socket.on('typing', ({ roomId, username }) => showTyping(roomId, username, true));
    socket.on('message', (message: Message) => {
      const { roomId } = message;
      showTyping(roomId, message.sender, false);
      if (message.sender === BOT_NAME) {
        setBotDrafts((prev) => ({ ...prev, [roomId]: undefined }));
      } else if (/^@bot\b/i.test(message.text)) {
        setBotDrafts((prev) => ({ ...prev, [roomId]: prev[roomId] ?? '' }));
        // shortcut: the server stays silent when it skips an @bot because bot is busy, so stop waiting after a while; have it say so if Users hit this.
        setTimeout(() => setBotDrafts((prev) => (prev[roomId] ? prev : { ...prev, [roomId]: undefined })), BOT_PATIENCE_MS);
      }
      setMessagesByRoom((prev) => ({
        ...prev,
        [roomId]: [...(prev[roomId] || []), message],
      }));
      if (roomId !== activeRoomId.current) {
        setUnreadCounts((prev) => ({
          ...prev,
          [roomId]: (prev[roomId] || 0) + 1,
        }));
      }
    });
    socket.on('connect_error', (err) => {
      // A network problem: Socket.IO keeps retrying by itself.
      if (socket.active) return setError("Can't reach the server. Still trying…");
      // Refused by the server: back to the login form.
      setError(err.message);
      setConnecting(false);
      setSocket(undefined);
      setOnlineList(undefined);
    });
    setSocket(socket);
  }

  function openPrivateRoom(targetUser: string) {
    // An old Group may store a Member's name in another case: the Room's title is the name in the Online List.
    const name = onlineList?.find((user) => user.toLowerCase() === targetUser.toLowerCase()) ?? targetUser;
    if (socket) showRoom(name, socket.timeout(10_000).emitWithAck('openPrivateRoom', name));
  }

  function openGroupRoom(name: string) {
    if (socket) showRoom(name, socket.timeout(10_000).emitWithAck('loadMessages', groupRoomId(name)));
  }

  /** Shows the Room the server answered `request` with in the main panel, or the reason it refused. */
  async function showRoom(title: string, request: Promise<RoomMessagesAck>) {
    try {
      const result = await request;
      if (result.ok) {
        setError('');
        const isNewRoom = activeRoomId.current !== result.roomId;
        activeRoomId.current = result.roomId;
        setMessagesByRoom((prev) => ({
          ...prev,
          [result.roomId]: result.messages,
        }));
        setUnreadCounts((prev) => ({
          ...prev,
          [result.roomId]: 0,
        }));
        // Last, and alone: the transition starts a frame later, and the updates above mustn't wait for it.
        if (isNewRoom) smoothly(() => setActiveRoom({ roomId: result.roomId, title }));
      } else {
        setError(result.error);
      }
    } catch {
      setError('No answer from the server. Try again.');
    }
  }

  if (!socket || !onlineList) {
    return (
      <main className="login">
        <form className="login-card" onSubmit={connect}>
          <h1 className="brand">Chat App</h1>
          <p className="login-tagline">Private Rooms, Groups, and a bot who read the Slides.</p>
          <label className="field">
            Username
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoFocus
            />
            <small>3–20 letters, digits or underscores</small>
          </label>
          <label className="field">
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          <Banner text={error || (connecting ? 'Connecting…' : '')} />
          <div className="login-actions">
            <button className="button" value="login" disabled={connecting}>
              Log in
            </button>
            <button className="button button-quiet" value="register" disabled={connecting}>
              Register
            </button>
          </div>
        </form>
      </main>
    );
  }

  const me = username.trim().toLowerCase();
  // The name as it was registered, which the login form's text may not match in case.
  const myName = onlineList.find((name) => name.toLowerCase() === me) ?? me;
  const activeGroup = groups.find((group) => groupRoomId(group.name) === activeRoom?.roomId);
  const memberCount = activeGroup?.members.length;
  const subtitle = activeGroup
    ? `${memberCount} ${memberCount === 1 ? 'Member' : 'Members'}`
    : activeRoom && onlineList.includes(activeRoom.title)
      ? 'Online'
      : "Offline. They'll see your Messages when they log in.";
  return (
    <main className="chat-layout">
      <aside className="sidebar">
        <h1 className="brand">Chat App</h1>
        <section>
          <h2>Online</h2>
          <ul>
            {onlineList.map((name) => {
              const isMe = name.toLowerCase() === me;
              if (isMe) {
                return (
                  <li key={name} className="row enter">
                    <span className="presence" />
                    {name} (you)
                  </li>
                );
              }
              const roomId = privateRoomId(me, name);
              const unread = unreadCounts[roomId] || 0;
              const isSelected = activeRoom?.roomId === roomId;
              return (
                <li key={name} className="enter">
                  <button
                    type="button"
                    className={`row row-button ${isSelected ? 'active' : ''}`}
                    aria-current={isSelected}
                    onClick={() => openPrivateRoom(name)}
                  >
                    <span className="presence" />
                    {name}
                    {unread > 0 && (
                      // The key restarts the pop on every new count.
                      <span key={unread} className="unread-count" aria-label={`${unread} unread`}>
                        {unread}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        <Groups
          socket={socket}
          groups={groups}
          me={me}
          activeRoomId={activeRoom?.roomId}
          unreadCounts={unreadCounts}
          onOpen={openGroupRoom}
        />
        {/* A login lives only in this page: reloading closes the socket and forgets the password and every Message. */}
        <button type="button" className="button button-quiet logout" onClick={() => location.reload()}>
          Log out
        </button>
      </aside>

      <section className="main-panel">
        <Banner text={error} />
        {activeRoom ? (
          <Room
            key={activeRoom.roomId}
            socket={socket}
            roomId={activeRoom.roomId}
            title={activeRoom.title}
            subtitle={subtitle}
            messages={messagesByRoom[activeRoom.roomId] || []}
            botDraft={botDrafts[activeRoom.roomId]}
            typers={typers[activeRoom.roomId] || []}
            me={me}
          />
        ) : (
          <div className="empty-panel">
            <h2>Pick a Room</h2>
            <p>Click an Online User to open a Private Room, or open a Group you're a Member of.</p>
          </div>
        )}
      </section>

      {activeRoom && (
        <MemberPanel
          names={activeGroup ? activeGroup.members : [myName, activeRoom.title]}
          onlineList={onlineList}
          me={me}
          onOpen={openPrivateRoom}
        />
      )}
    </main>
  );
}
