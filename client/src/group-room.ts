/** A Group's Room id is `#` and the Group's lowercase name, the same as the server's. */
export function groupRoomId(name: string): string {
  return `#${name.trim().toLowerCase()}`;
}
