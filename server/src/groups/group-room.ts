/**
 * A Group's Room id is `#` and the Group's lowercase name, which is also the Socket.IO room its Members' Clients join.
 * Usernames can't contain `#`, so it can never be mistaken for a Private Room's `alice:bob`.
 */
export function groupRoomId(name: string): string {
  return `#${name.trim().toLowerCase()}`;
}

/** The lowercase Group name in a Group's Room id, or undefined if `roomId` isn't a Group's. */
export function groupKeyOf(roomId: string): string | undefined {
  return roomId.startsWith('#') ? roomId.slice(1) : undefined;
}
