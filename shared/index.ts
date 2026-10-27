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

export interface ServerToClientEvents {
  /** The names of every Online User, sent to every Client on every connect and disconnect. */
  onlineList: (names: string[]) => void;
}
