import { Api, type SentMessage } from './api';
import { apiFor, readPeople } from './people';

export const HISTORY_LENGTH = 230;
export const OLD_THREAD_REPLIES = 30;

/**
 * A channel with a long past that tests read and never write to: 230
 * messages from Ada and Ben in turn (`history 001` is the oldest), a thread
 * of 30 replies under `history 020`, far back, and one of 3 replies under
 * `history 225`, near the end. The first page the app asks for is 50
 * messages and further pages are 100, so the start of this history is
 * several pages away.
 */
export type History = {
  id: string;
  name: string;
  texts: string[];
  messages: SentMessage[];
  oldThread: { root: SentMessage; replies: SentMessage[] };
  recentThread: { root: SentMessage; replies: SentMessage[] };
};

export function historyText(position: number): string {
  return `history ${String(position).padStart(3, '0')}`;
}

export async function makeHistory(): Promise<History> {
  const people = readPeople();
  const adaHttp = await apiFor('ada');
  const benHttp = await apiFor('ben');
  const ada = new Api(people.ada, adaHttp);
  const ben = new Api(people.ben, benHttp);

  const channel = await ada.createChannel({ members: [people.ben] });
  const texts = Array.from({ length: HISTORY_LENGTH }, (_, index) =>
    historyText(index + 1)
  );

  const messages: SentMessage[] = [];
  for (const [index, text] of texts.entries()) {
    messages.push(await (index % 2 === 0 ? ada : ben).post(channel.id, text));
  }

  const replies = async (root: SentMessage, label: string, count: number) => {
    const sent: SentMessage[] = [];
    for (let reply = 1; reply <= count; reply += 1) {
      sent.push(
        await (reply % 2 === 0 ? ada : ben).post(
          channel.id,
          `${label} reply ${String(reply).padStart(2, '0')}`,
          { threadId: root.id }
        )
      );
    }
    return { root, replies: sent };
  };

  const oldThread = await replies(messages[19], 'old', OLD_THREAD_REPLIES);
  const recentThread = await replies(messages[224], 'recent', 3);

  await adaHttp.dispose();
  await benHttp.dispose();
  return { ...channel, texts, messages, oldThread, recentThread };
}
