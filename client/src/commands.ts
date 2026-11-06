import type { VoteKick } from '@compnet/shared';

/** Commands the open Room can do by itself. */
type RoomCommand = { name: 'help' } | { name: 'leave' } | { name: 'unsend' };

/** Commands that need the Online List, the Groups or the votes, which App has. */
export type AppCommand =
  | { name: 'kick'; target: string }
  | { name: 'vote'; yes: boolean }
  | { name: 'join'; group: string }
  | { name: 'msg'; user: string };

export type Command = RoomCommand | AppCommand;

/** What /help lists. */
export const COMMAND_HELP = [
  ['/kick name', 'Start a Vote Kick on an Online Member, or Kick an offline one'],
  ['/vote yes, /vote no', 'Vote in a Vote Kick. F1 and F2 do the same'],
  ['/join Group', 'Join a Group and open it'],
  ['/leave', 'Leave this Group'],
  ['/msg name', 'Open the Private Room with an Online User'],
  ['/unsend', 'Unsend your last Message here'],
  ['/help', 'Show this list'],
  ['@bot question', 'Ask bot, in a Message everyone here sees'],
];

/**
 * Reads a line from a Room's text box: a Command, a hint about one, or undefined for a Message.
 * A Command's word ends at a space or the end of the line, so `/etc/hosts` stays a Message.
 */
export function parseCommand(line: string): Command | { error: string } | undefined {
  const match = /^\/(\w+)(?:\s+(.*))?$/.exec(line.trim());
  if (!match) return undefined;
  const [, word, rest = ''] = match;
  const name = word.toLowerCase();
  switch (name) {
    case 'help':
    case 'leave':
    case 'unsend':
      return { name };
    case 'kick':
      return rest ? { name, target: rest } : { error: 'Use /kick name.' };
    case 'msg':
      return rest ? { name, user: rest } : { error: 'Use /msg name.' };
    case 'join':
      return rest ? { name, group: rest } : { error: 'Use /join Group.' };
    case 'vote': {
      const answer = rest.toLowerCase();
      return answer === 'yes' || answer === 'no' ? { name, yes: answer === 'yes' } : { error: 'Use /vote yes or /vote no.' };
    }
    default:
      return { error: `There is no /${word} Command. Try /help.` };
  }
}

/** The vote F1, F2 and /vote act on: the open Room's if it's waiting for `me`, otherwise the oldest that is. `votes` are oldest first. */
export function voteToCast<Vote extends Pick<VoteKick, 'roomId' | 'waitingFor'>>(votes: Vote[], me: string, activeRoomId?: string): Vote | undefined {
  const waiting = votes.filter(({ waitingFor }) => waitingFor.includes(me));
  return waiting.find(({ roomId }) => roomId === activeRoomId) ?? waiting[0];
}
