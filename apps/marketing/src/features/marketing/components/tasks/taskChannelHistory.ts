import type { WorkspaceComment } from '../../core/dummy-workspace';

/** Everyday discussion around the task requests, with stable local message IDs. */
export function taskChannelHistory(channel: string): WorkspaceComment[] {
  const chats: Record<string, [WorkspaceComment['person'], string][]> = {
    sales: [
      ['wolf', 'did they say friday morning or end of day?'],
      ['peter', 'end of day. i asked twice just to be sure'],
      ['eric', 'nice, that gives me time to check the numbers'],
      ['rahul', 'i added their question about mobile to the brief'],
      ['wolf', 'saw it. keeping that in the scope'],
      ['peter', 'can someone give the draft a quick read after lunch?'],
      ['eric', 'yep, ping me when it’s ready'],
    ],
    customers: [
      ['rahul', 'they tried the new invite link and got in this time'],
      ['wolf', 'finally. did the rest of their team join too?'],
      ['rahul', 'two so far. the others are trying it this afternoon'],
      ['peter', 'i’ll check in tomorrow, no need to chase them today'],
      ['eric', 'left the answers to their setup questions in the task'],
      ['wolf', 'thanks, using those for the next call too'],
    ],
    website: [
      ['austin', 'new screenshots are in the folder'],
      ['rahul', 'checking them on my phone now'],
      ['rahul', 'second one is a bit blurry. is that the old export?'],
      ['austin', 'oops yes. replaced it'],
      ['wolf', 'copy is ready too. cut the intro down a lot'],
      ['eric', 'much better. i can actually read it without scrolling forever'],
      ['rahul', 'mobile looks good now 👍'],
    ],
  };
  return (chats[channel] ?? []).map(([person, body], index) => ({
    id: `${channel}-conversation-${index}`,
    person,
    body,
    time: `10:${String(12 + index * 2).padStart(2, '0')} AM`,
  }));
}
