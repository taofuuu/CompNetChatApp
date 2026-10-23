// The socket contract between server and Client: each event's name is its key here, its payload the argument.
// Types only, so both sides `import type` it and nothing needs building.

/** What a Client sends in the Socket.IO connection handshake (`auth`). */
export interface HandshakeAuth {
  username: string;
  /**
   * A random id the page keeps in localStorage, so a second Client in the same browser counts as the same User.
   * shortcut: stands in for a password; passwords (#7) replace it.
   */
  browserId: string;
}

export interface ServerToClientEvents {
  /** The names of every Online User, sent to every Client on every connect and disconnect. */
  onlineList: (names: string[]) => void;
}
