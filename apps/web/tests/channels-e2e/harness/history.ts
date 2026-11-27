import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Api, type SentMessage } from './api';
import { apiFor, cast, readPeople } from './people';
import { runDirectory, stackUrl } from './stack';

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

async function makeHistory(ofCast: number): Promise<History> {
  const people = readPeople(ofCast);
  const adaHttp = await apiFor('ada', ofCast);
  const benHttp = await apiFor('ben', ofCast);
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

function historyFile(ofCast: number): string {
  return join(runDirectory(), `history-${ofCast}.json`);
}

type StoredHistory = { stack: string; history: History };

async function stillThere(history: History, ofCast: number): Promise<boolean> {
  const http = await apiFor('ada', ofCast);
  const selection = JSON.stringify({ limit: 1, direction: 'older' });
  const response = await http.get(
    `/dss/messages/channel/${history.id}/timeline?selection=${encodeURIComponent(selection)}`
  );
  await http.dispose();
  return response.ok();
}

/**
 * Makes a cast's history before any test runs, or keeps the one an earlier run
 * against the same stack made: nothing writes to it, so it stays what it
 * was. Making it while tests run would send every open page of Ada's and
 * Ben's hundreds of new messages a second, which no test means to measure.
 */
export async function prepareHistory(ofCast: number): Promise<void> {
  if (existsSync(historyFile(ofCast))) {
    const stored = JSON.parse(
      readFileSync(historyFile(ofCast), 'utf8')
    ) as StoredHistory;
    if (
      stored.stack === stackUrl() &&
      (await stillThere(stored.history, ofCast))
    ) {
      return;
    }
  }
  const stored: StoredHistory = {
    stack: stackUrl(),
    history: await makeHistory(ofCast),
  };
  writeFileSync(historyFile(ofCast), JSON.stringify(stored));
}

export function readHistory(ofCast = cast()): History {
  const stored = JSON.parse(
    readFileSync(historyFile(ofCast), 'utf8')
  ) as StoredHistory;
  return stored.history;
}

/**
 * Takes every channel out of the cast's Favorites. The sidebar draws only the
 * rows near its window, so on a stack many runs have used the row a test has
 * just made would be past the ones drawn.
 */
export async function clearFavoriteChannels(ofCast: number): Promise<void> {
  const http = await apiFor('ada', ofCast);
  try {
    const listed = await http.get('/dss/favorites?entityType=channel');
    if (!listed.ok()) {
      throw new Error(`list favorites failed (${listed.status()})`);
    }
    const { favorites } = (await listed.json()) as {
      favorites: { entityId: string }[];
    };
    for (const { entityId } of favorites) {
      const removed = await http.delete(`/dss/favorites/channel/${entityId}`);
      if (!removed.ok() && removed.status() !== 404) {
        throw new Error(`remove favorite failed (${removed.status()})`);
      }
    }
  } finally {
    await http.dispose();
  }
}
