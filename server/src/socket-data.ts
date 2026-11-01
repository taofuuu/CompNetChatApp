/** What the server remembers about a connected Client, set by the handshake check: the User it logged in as, by their stored username. */
export interface SocketData {
  username: string;
}
