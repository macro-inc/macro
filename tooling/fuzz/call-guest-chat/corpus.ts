import { readFileSync } from "node:fs";

export type Message = {
  id: string;
  parent: { type: string; id: string };
  kind: "message" | "call_root";
  sender_id: string;
  content: string;
  mentions: { entity_type: string; entity_id: string }[];
  attachments: {
    id: string;
    entity_type: string;
    entity_id: string;
    created_at: string;
  }[];
  reactions: { emoji: string; users: string[] }[];
  created_at: string;
  updated_at: string;
  thread_id?: string;
  guest_name?: string;
  imported_author?: { name: string };
  bot_profile?: { name: string; avatar_url?: string };
  deleted_at?: string;
  edited_at?: string;
};

export type Thread = {
  root: Message;
  replies: Message[];
  state: {
    root_id: string;
    user_id: string;
    anchor: null;
    resolved: boolean;
    created_at: string;
    updated_at: string;
  };
};

export type Corpus = {
  viewerId: string;
  threads: Thread[];
  labels?: Record<string, string>;
};

const time = "2026-01-01T00:00:00Z";
const viewerId = "macro|fixture-viewer@example.com";

function random(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

export function generated(seed = 10268, count = 12): Corpus {
  const next = random(seed);
  const parents = ["channel", "channel", "document", "call"] as const;
  const contents = [
    "Short message",
    "Edited message with **bold** and a link to https://example.test",
    "A long message. ".repeat(80),
    '<m-reply-target id="quoted-message" /> Quoted reply',
    "Mentioning @fixture-user and an attachment",
  ];
  const threads: Thread[] = [];
  const labels: Record<string, string> = {};
  const kinds = ["channel", "dm", "document", "call"];
  for (let index = 0; index < count; index++) {
    const parent = {
      type: parents[index % parents.length],
      id: `00000000-0000-7000-8000-${String(index + 100).padStart(12, "0")}`,
    };
    const rootId = `00000000-0000-7000-8000-${String(index + 1000).padStart(12, "0")}`;
    const senderId =
      index % 5 === 3 || [4, 5, 10].includes(index)
        ? viewerId
        : `macro|fixture-${index % 7}@example.com`;
    const root: Message = {
      id: rootId,
      parent,
      kind: parent.type === "call" && index % 2 === 0 ? "call_root" : "message",
      sender_id: senderId,
      content: contents[Math.floor(next() * contents.length)],
      mentions:
        index % 3 === 0
          ? [{ entity_type: "user", entity_id: "fixture-user" }]
          : [],
      attachments:
        index % 4 === 0
          ? [
              {
                id: `attachment-${index}`,
                entity_type: "document",
                entity_id: "fixture-document",
                created_at: time,
              },
            ]
          : [],
      reactions:
        index % 2 === 0
          ? [
              {
                emoji: "👍",
                users: [viewerId, "macro|fixture-other@example.com"],
              },
            ]
          : [],
      created_at: time,
      updated_at: time,
    };
    if (index % 6 === 0) root.deleted_at = time;
    if (index % 6 === 1) root.edited_at = time;
    if (index % 7 === 0) {
      root.imported_author = { name: "Imported author" };
      root.sender_id = `external:fixture-${index}`;
    }
    if (index % 7 === 1) {
      root.guest_name = "Call guest";
      root.sender_id = `guest:fixture-${index}`;
    }
    if (index % 7 === 2) {
      root.bot_profile = { name: "Assistant" };
      root.sender_id = `bot|fixture-${index}`;
    }
    const replies = Array.from(
      { length: (index + 1) % 5 },
      (_, replyIndex): Message => ({
        ...root,
        id: `00000000-0000-7000-8000-${String(5000 + index * 10 + replyIndex).padStart(12, "0")}`,
        kind: "message",
        content: contents[(index + replyIndex) % contents.length],
        sender_id:
          replyIndex === 0
            ? viewerId
            : `macro|fixture-${replyIndex}@example.com`,
        thread_id: rootId,
        deleted_at: undefined,
        edited_at: replyIndex === 1 ? time : undefined,
        guest_name: undefined,
        imported_author: undefined,
        bot_profile: undefined,
      }),
    );
    threads.push({
      root,
      replies,
      state: {
        root_id: rootId,
        user_id: root.sender_id,
        anchor: null,
        resolved: index % 8 === 0,
        created_at: time,
        updated_at: time,
      },
    });
    labels[rootId] = kinds[index % kinds.length]!;
  }
  return { viewerId, threads, labels };
}

export function loadCorpus(path?: string): Corpus {
  if (!path) return generated(10268, Number(process.env.CGC_COUNT ?? 12));
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Corpus;
  if (!Array.isArray(parsed.threads) || typeof parsed.viewerId !== "string") {
    throw new Error("Corpus must contain viewerId and threads");
  }
  return parsed;
}
