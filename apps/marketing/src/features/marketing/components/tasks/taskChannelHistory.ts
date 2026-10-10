import type { WorkspaceComment } from '../../core/dummy-workspace';

/** Everyday discussion around the task requests, with stable local message IDs. */
export function taskChannelHistory(channel: string): WorkspaceComment[] {
  const chats: Record<string, [WorkspaceComment['person'], string][]> = {
    sales: [
      ['julia', 'did they say friday morning or end of day?'],
      ['jacob', 'end of day. i asked twice just to be sure'],
      ['teo', 'nice, that gives me time to check the numbers'],
      ['gabriel', 'i added their question about mobile to the brief'],
      ['julia', 'saw it. keeping that in the scope'],
      ['jacob', 'can someone give the draft a quick read after lunch?'],
      ['teo', 'yep, ping me when it’s ready'],
    ],
    customers: [
      ['gabriel', 'they tried the new invite link and got in this time'],
      ['julia', 'finally. did the rest of their team join too?'],
      ['gabriel', 'two so far. the others are trying it this afternoon'],
      ['jacob', 'i’ll check in tomorrow, no need to chase them today'],
      ['teo', 'left the answers to their setup questions in the task'],
      ['julia', 'thanks, using those for the next call too'],
    ],
    website: [
      ['valentina', 'new screenshots are in the folder'],
      ['gabriel', 'checking them on my phone now'],
      ['gabriel', 'second one is a bit blurry. is that the old export?'],
      ['valentina', 'oops yes. replaced it'],
      ['julia', 'copy is ready too. cut the intro down a lot'],
      ['teo', 'much better. i can actually read it without scrolling forever'],
      ['gabriel', 'mobile looks good now 👍'],
    ],
  };
  return (chats[channel] ?? []).map(([person, body], index) => ({
    id: `${channel}-conversation-${index}`,
    person,
    body,
    time: `10:${String(12 + index * 2).padStart(2, '0')} AM`,
  }));
}
