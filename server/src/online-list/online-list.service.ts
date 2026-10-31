import { Injectable } from '@nestjs/common';

/** Who is Online. Knows nothing about sockets: the gateway tells it when Clients come and go. */
@Injectable()
export class OnlineListService {
  /** Every Online User, keyed by their lowercase name. */
  private readonly onlineUsers = new Map<string, { name: string; clients: number }>();

  addClient(name: string) {
    const user = this.onlineUsers.get(name.toLowerCase());
    if (user) user.clients++;
    else this.onlineUsers.set(name.toLowerCase(), { name, clients: 1 });
  }

  /** A User stays Online until their last Client is removed. */
  removeClient(name: string) {
    const key = name.toLowerCase();
    const user = this.onlineUsers.get(key);
    if (user && --user.clients === 0) this.onlineUsers.delete(key);
  }

  /** The Online List: every Online User's name as they first typed it. */
  names() {
    return [...this.onlineUsers.values()].map((user) => user.name);
  }

  /** Whether a User with `name` (ignoring case) is currently Online. */
  isOnline(name: string): boolean {
    return this.onlineUsers.has(name.toLowerCase());
  }
}
