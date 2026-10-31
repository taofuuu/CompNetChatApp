/**
 * A Private Room's id comes from both usernames (ignoring case) in sorted order,
 * so Alice→Bob and Bob→Alice are the same Room.
 */
export function privateRoomId(userA: string, userB: string): string {
  const sorted = [userA.toLowerCase(), userB.toLowerCase()].sort();
  return `${sorted[0]}:${sorted[1]}`;
}
