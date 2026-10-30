// The socket contract between server and Client: each event's name is its key here, its payload the argument.
// Types only, so both sides `import type` it and nothing needs building.

/** Whether a Client's handshake registers a new User or logs in as an existing one. */
export type AuthMode = 'register' | 'login';

/** What a Client sends in the Socket.IO connection handshake (`auth`). */
export interface HandshakeAuth {
  mode: AuthMode;
  username: string;
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

export interface ServerToClientEvents {
  /** The names of every Online User, sent to every Client on every connect and disconnect. */
  onlineList: (names: string[]) => void;
  /** Every Group with its Members, oldest first: sent to a Client when it connects and to every Client on every create or join. */
  groupList: (groups: GroupSummary[]) => void;
}

export interface ClientToServerEvents {
  /** Creates a Group named `name` with the sender as its only Member. */
  createGroup: (name: string, ack: (result: Ack) => void) => void;
  /** Adds the sender, and only the sender, to the Group named `name`. */
  joinGroup: (name: string, ack: (result: Ack) => void) => void;
}
