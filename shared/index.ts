// The socket contract between server and Client: each event's name is its key here, its payload the argument.
// Types only, so both sides `import type` it and nothing needs building.

/** Whether a Client's handshake registers a new User or logs in as an existing one. */
export type AuthMode = 'register' | 'login';

/** What a Client sends in the Socket.IO connection handshake (`auth`). */
export interface HandshakeAuth {
  mode: AuthMode;
  username: string;
  /** shortcut: sent as plain text, since the hotspot demo serves plain HTTP; serve the page over HTTPS before real use. */
  password: string;
}

/** The server's answer to a Client's request: success, or the reason it was refused. */
export type Ack = { ok: true } | { ok: false; error: string };

/** A Group as every Client sees it in the Group list. */
export interface GroupSummary {
  name: string;
  /** Every Member's name, the creator first. */
  members: string[];
}

/** A Message sent into a Room. */
export interface Message {
  /** Missing only on a notice from bot that couldn't be saved. */
  id?: string;
  /** `alice:bob` for a Private Room (both lowercase usernames, sorted), `#study` for a Group (its lowercase name). */
  roomId: string;
  sender: string;
  /** Empty once the Message is unsent: the text is gone from the database too. */
  text: string;
  createdAt: string;
  /** Set once the sender has unsent it. A Client then shows a placeholder in its place. */
  unsent?: boolean;
}

/** The server's answer when opening a Room or loading its history. */
export type RoomMessagesAck =
  | { ok: true; roomId: string; messages: Message[] }
  | { ok: false; error: string };

/** The payload for sending a Message into a Room. */
export interface SendMessagePayload {
  roomId: string;
  text: string;
}

/** A piece of the bot's reply as it is written. The finished reply then arrives as a normal Message. */
export interface BotChunk {
  roomId: string;
  text: string;
}

/** A Message that has just been unsent. Carries no text: the Client already has the rest of the Message, if it has it at all. */
export interface MessageUnsent {
  roomId: string;
  id: string;
}

/** A User is typing in a Room. Never saved: a Client shows it for a moment and then forgets it. */
export interface Typing {
  roomId: string;
  username: string;
}

export interface ServerToClientEvents {
  /** The names of every Online User, sent to every Client on every connect and disconnect. */
  onlineList: (names: string[]) => void;
  /** Every Group with its Members, oldest first: sent to a Client when it connects and to every Client on every create or join. */
  groupList: (groups: GroupSummary[]) => void;
  /** A new Message sent into a Room the Client is in. */
  message: (message: Message) => void;
  /** A Message in a Room the Client is in was unsent. */
  messageUnsent: (unsent: MessageUnsent) => void;
  /** The next piece of the bot's reply in a Room the Client is in. */
  botChunk: (chunk: BotChunk) => void;
  /** Another User in a Room the Client is in is typing. */
  typing: (typing: Typing) => void;
}

export interface ClientToServerEvents {
  /** Creates a Group named `name` with the sender as its only Member. */
  createGroup: (name: string, ack: (result: Ack) => void) => void;
  /** Adds the sender, and only the sender, to the Group named `name`. */
  joinGroup: (name: string, ack: (result: Ack) => void) => void;
  /** Opens the Private Room between the sender and `targetUsername`, returning the Room id and history. */
  openPrivateRoom: (targetUsername: string, ack: (result: RoomMessagesAck) => void) => void;
  /** Loads the message history for `roomId`. */
  loadMessages: (roomId: string, ack: (result: RoomMessagesAck) => void) => void;
  /** Sends a Message into `roomId`. */
  sendMessage: (payload: SendMessagePayload, ack: (result: Ack) => void) => void;
  /** Unsends the sender's own Message with this id. It can't be undone. */
  unsendMessage: (id: string, ack: (result: Ack) => void) => void;
  /** Says the sender is typing in `roomId`. Repeated while they type; there is no "stopped" event. */
  typing: (roomId: string) => void;
}
