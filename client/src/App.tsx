import type {
  Ack,
  AuthMode,
  ClientToServerEvents,
  GroupSummary,
  HandshakeAuth,
  HistoryEntry,
  Message,
  RoomMessagesAck,
  ServerToClientEvents,
} from '@compnet/shared';
import { type FormEvent, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { io, type Socket } from 'socket.io-client';
import { Banner } from './Banner';
import { type AppCommand, voteToCast } from './commands';
import { useConfirm } from './confirm-popup';
import { groupRoomId } from './group-room';
import { Groups } from './Groups';
import { MemberPanel } from './MemberPanel';
import { privateRoomId } from './private-room';
import { BOT_NAME, Room } from './Room';
import { type LiveVoteKick, VoteKickBanner } from './VoteKickBanner';

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
  /** When each Group's block on this User ends, by Group name, on the `performance.now()` clock. */
  const [kickBlocks, setKickBlocks] = useState<Record<string, number>>({});
  /** The Vote Kick running in each of this User's Groups, by Room id. Kept here, not in <Room>, so the sidebar shows it and a Room opened mid-vote has it. */
  const [voteKicks, setVoteKicks] = useState<Record<string, LiveVoteKick>>({});
  const [activeRoom, setActiveRoom] = useState<{ roomId: string; title: string } | null>(null);
  const activeRoomId = useRef('');
  const [messagesByRoom, setMessagesByRoom] = useState<Record<string, HistoryEntry[]>>({});
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  /** The bot's reply so far, by Room: empty before its first word, undefined when it isn't answering. */
  const [botDrafts, setBotDrafts] = useState<Record<string, string | undefined>>({});
  /** The other Users typing right now, by Room. */
  const [typers, setTypers] = useState<Record<string, string[]>>({});
  const typingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [error, setError] = useState('');
  const [confirm, confirmPopup] = useConfirm();

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
    socket.on('disconnect', () => {
      setError('Connection lost. Reconnecting…');
      // A vote that ends now is never heard of. The server sends the running ones on reconnecting.
      setVoteKicks({});
    });
    // The first list is what lets the chat screen in.
    let loggedIn = false;
    socket.on('onlineList', (names) => {
      if (loggedIn) return setOnlineList(names);
      loggedIn = true;
      smoothly(() => setOnlineList(names));
    });
    // Listened for here, not in <Groups>, so the list sent right after connecting isn't missed.
    socket.on('groupList', (groups) => {
      setGroups(groups);
      // A deleted Group's block goes with it, so a new Group with the name has none.
      // shortcut: a Group deleted and recreated within one list read keeps a false countdown until it ends or the Client reconnects; give Groups an id if Users hit this.
      setKickBlocks((prev) => Object.fromEntries(Object.entries(prev).filter(([name]) => groups.some((group) => group.name === name))));
      // How every Client of a User who left, or whose Group was deleted, hears it, even one that was disconnected at the time.
      // shortcut: a Room this Client opens just as the User leaves on another stays open until the next list, with sending refused; check membership in showRoom if Users hit this.
      // shortcut: a Client that misses a deletion because the same User recreates the Group while it's disconnected keeps the old unread count until it opens the Room; give Groups an id if Users hit this.
      const me = username.trim().toLowerCase();
      const mine = groups.filter(({ members }) => members.some((member) => member.toLowerCase() === me));
      const myRooms = new Set(mine.map(({ name }) => groupRoomId(name)));
      const isOut = (roomId: string) => roomId.startsWith('#') && !myRooms.has(roomId);
      // Nothing stays of a Room they're out of: the rest of a reply bot was writing will never arrive, and a new Group with the name starts clean.
      const forgetRoomsOut = <T,>(byRoom: Record<string, T>) => Object.fromEntries(Object.entries(byRoom).filter(([roomId]) => !isOut(roomId)));
      setMessagesByRoom(forgetRoomsOut);
      setUnreadCounts(forgetRoomsOut);
      setBotDrafts(forgetRoomsOut);
      setTypers(forgetRoomsOut);
      setVoteKicks(forgetRoomsOut);
      if (isOut(activeRoomId.current)) {
        activeRoomId.current = '';
        smoothly(() => setActiveRoom(null));
      }
    });
    // performance.now(), not Date.now(): a wrong or changed computer clock can't move the countdown.
    socket.on('kickBlocks', (blocks) => {
      const receivedAt = performance.now();
      setKickBlocks(Object.fromEntries(blocks.map(({ name, msLeft }) => [name, receivedAt + msLeft])));
    });
    socket.on('voteKick', (vote) => {
      const endsAt = performance.now() + vote.msLeft;
      setVoteKicks((prev) => ({ ...prev, [vote.roomId]: { ...vote, endsAt } }));
    });
    socket.on('voteKickEnded', (roomId) => {
      setVoteKicks((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => id !== roomId)));
    });
    // The Group list closes the Room; this says why.
    socket.on('votedOut', (groupName) => setError(`You were kicked out of ${groupName}`));
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
    // Unlike a Message, it raises no unread count.
    socket.on('announcement', (announcement) => {
      const { roomId } = announcement;
      setMessagesByRoom((prev) => ({
        ...prev,
        [roomId]: [...(prev[roomId] || []), announcement],
      }));
    });
    // shortcut: a history read just before the wipe that arrives after this shows the text until the next load; ignore stale loads if Users hit this.
    socket.on('messageUnsent', ({ roomId, id }) => {
      setMessagesByRoom((prev) => ({
        ...prev,
        [roomId]: (prev[roomId] || []).map((entry) => ('sender' in entry && entry.id === id ? { ...entry, text: '', unsent: true } : entry)),
      }));
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

  /** Waits for the server's answer and shows why it refused, if it did. True if it agreed. */
  async function showRefusal(request: Promise<Ack>) {
    try {
      const result = await request;
      setError(result.ok ? '' : result.error);
      return result.ok;
    } catch {
      setError('No answer from the server. Try again.');
      return false;
    }
  }

  async function askToRemove(event: 'kickMember' | 'startVoteKick', groupName: string, member: string) {
    if (socket) await showRefusal(socket.timeout(10_000).emitWithAck(event, { name: groupName, target: member }));
  }

  async function castVote(vote: LiveVoteKick, yes: boolean) {
    if (socket) await showRefusal(socket.timeout(10_000).emitWithAck('castVote', { name: vote.group, yes }));
  }

  // A prompt, because the Kick is instant and nobody else has to agree.
  async function kick(groupName: string, member: string) {
    if (await confirm({ title: `Kick ${member}?`, text: `They can't join ${groupName} again for 10 minutes.`, action: 'Kick' })) void askToRemove('kickMember', groupName, member);
  }

  // For the button only, where a slip starts a public vote nobody can cancel. Typing /kick is already deliberate.
  async function startVoteKick(groupName: string, member: string) {
    const question = { title: `Vote to kick ${member}?`, text: `Everyone in ${groupName} sees it for 30 seconds, and it can't be cancelled.`, action: 'Start vote' };
    if (await confirm(question)) await askToRemove('startVoteKick', groupName, member);
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
  const runningVotes = Object.values(voteKicks);
  const voteForKeys = voteToCast(runningVotes, me, activeRoom?.roomId);

  /** Runs a Command, and returns why not if it can't be tried. The Room shows that, beside the text box. */
  const runCommand = async (command: AppCommand): Promise<string | void> => {
    switch (command.name) {
      case 'msg':
        return openPrivateRoom(command.user);
      case 'vote':
        return voteForKeys ? castVote(voteForKeys, command.yes) : 'You have no vote to cast.';
      case 'join': {
        // The name as stored, for the Room's title.
        const name = groups.find((group) => group.name.toLowerCase() === command.group.toLowerCase())?.name ?? command.group;
        if (await showRefusal(socket.timeout(10_000).emitWithAck('joinGroup', name))) openGroupRoom(name);
        return;
      }
      case 'kick': {
        if (!activeGroup) return '/kick only works in a Group.';
        const member = activeGroup.members.find((name) => name.toLowerCase() === command.target.toLowerCase());
        if (!member) return 'They are not a Member of this Group.';
        const isOnline = onlineList.some((name) => name.toLowerCase() === member.toLowerCase());
        return isOnline ? askToRemove('startVoteKick', activeGroup.name, member) : kick(activeGroup.name, member);
      }
    }
  };

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
          kickBlocks={kickBlocks}
          voteKicks={voteKicks}
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
            groupName={activeGroup?.name}
            messages={messagesByRoom[activeRoom.roomId] || []}
            botDraft={botDrafts[activeRoom.roomId]}
            typers={typers[activeRoom.roomId] || []}
            me={me}
            confirm={confirm}
            onCommand={runCommand}
          />
        ) : (
          <div className="empty-panel">
            <h2>Pick a Room</h2>
            <p>Click an Online User to open a Private Room, or open a Group you're a Member of.</p>
          </div>
        )}
        <div className="vote-panels">
          {runningVotes.map((vote) => (
            <VoteKickBanner key={vote.roomId} vote={vote} me={me} hasKeys={vote === voteForKeys} onVote={(yes) => castVote(vote, yes)} />
          ))}
        </div>
      </section>

      {activeRoom && (
        <MemberPanel
          names={activeGroup ? activeGroup.members : [myName, activeRoom.title]}
          onlineList={onlineList}
          me={me}
          onOpen={openPrivateRoom}
          onKick={activeGroup && ((name) => kick(activeGroup.name, name))}
          onVoteKick={activeGroup && ((name) => startVoteKick(activeGroup.name, name))}
        />
      )}
      {confirmPopup}
    </main>
  );
}
