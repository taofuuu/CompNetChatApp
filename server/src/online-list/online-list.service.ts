import { Injectable } from '@nestjs/common';

/** Who is Online. Knows nothing about sockets: the gateway tells it when Clients come and go. */
@Injectable()
export class OnlineListService {
  /** Every Online User, keyed by their lowercase name. */
  private readonly onlineUsers = new Map<string, { name: string; browserId: string; clients: number }>();

  /** The Online User who already has `name` (ignoring case) from another browser, if any. */
  takenBy(name: string, browserId: string): string | undefined {
    const user = this.onlineUsers.get(name.toLowerCase());
    // Only the browser that brought this User Online can add Clients to them.
    return user && browserId !== user.browserId ? user.name : undefined;
  }

  addClient(name: string, browserId: string) {
    const user = this.onlineUsers.get(name.toLowerCase());
    if (user) user.clients++;
    else this.onlineUsers.set(name.toLowerCase(), { name, browserId, clients: 1 });
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
}
