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
  roomId: string;
  sender: string;
  text: string;
  createdAt: string;
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

export interface ServerToClientEvents {
  /** The names of every Online User, sent to every Client on every connect and disconnect. */
  onlineList: (names: string[]) => void;
  /** Every Group with its Members, oldest first: sent to a Client when it connects and to every Client on every create or join. */
  groupList: (groups: GroupSummary[]) => void;
  /** A new Message sent into a Room the Client is in. */
  message: (message: Message) => void;
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
}
