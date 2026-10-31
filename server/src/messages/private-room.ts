/**
 * A Private Room's id comes from both usernames (ignoring case) in sorted order,
 * so Alice→Bob and Bob→Alice are the same Room.
 */
export function privateRoomId(userA: string, userB: string): string {
  const sorted = [userA.toLowerCase(), userB.toLowerCase()].sort();
  return `${sorted[0]}:${sorted[1]}`;
}

/**
 * Checks whether `username` is one of the two Users in `roomId`.
 */
export function isUserInPrivateRoom(username: string, roomId: string): boolean {
  const parts = roomId.split(':');
  return (
    parts.length === 2 &&
    parts[0] !== parts[1] &&
    parts.includes(username.toLowerCase()) &&
    roomId === privateRoomId(parts[0], parts[1])
  );
}
