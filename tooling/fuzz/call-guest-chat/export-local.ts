import {
  closeSync,
  constants,
  fchmodSync,
  openSync,
  writeFileSync,
} from "node:fs";
import { generated, type Corpus, type Message, type Thread } from "./corpus";

const maxThreads = Number(process.env.CGC_MAX_THREADS ?? 100);
if (!Number.isInteger(maxThreads) || maxThreads < 1 || maxThreads > 1000) {
  throw new Error("CGC_MAX_THREADS must be an integer from 1 to 1000");
}
const query = `WITH chosen AS (
  SELECT * FROM comms_message_threads
  ORDER BY md5(root_id::text || '10268')
  LIMIT ${maxThreads}
), selected_messages AS (
  SELECT m.* FROM comms_messages m
  WHERE m.id IN (SELECT root_id FROM chosen)
     OR m.thread_id IN (SELECT root_id FROM chosen)
)
SELECT json_build_object(
  'messages', COALESCE((SELECT json_agg(row_to_json(m)) FROM selected_messages m), '[]'::json),
  'threads', COALESCE((SELECT json_agg(row_to_json(t)) FROM chosen t), '[]'::json),
  'reactions', COALESCE((SELECT json_agg(row_to_json(r)) FROM comms_reactions r WHERE r.message_id IN (SELECT id FROM selected_messages)), '[]'::json),
  'attachments', COALESCE((SELECT json_agg(row_to_json(a)) FROM comms_attachments a WHERE a.message_id IN (SELECT id FROM selected_messages)), '[]'::json),
  'mentions', COALESCE((SELECT json_agg(row_to_json(e)) FROM comms_entity_mentions e WHERE e.source_entity_type = 'message' AND e.source_entity_id IN (SELECT id::text FROM selected_messages)), '[]'::json),
  'channels', COALESCE((SELECT json_agg(json_build_object('id', c.id, 'channel_type', c.channel_type)) FROM comms_channels c WHERE c.id::text IN (SELECT parent_entity_id FROM chosen WHERE parent_entity_type = 'channel')), '[]'::json)
)`;

const output = process.argv[2];
if (!output?.startsWith("/tmp/")) throw new Error("Output must be under /tmp");
const database = process.env.DATABASE_URL;
const command = database
  ? ["psql", database, "-Atc", query]
  : [
      "docker",
      "exec",
      "-e",
      "PGOPTIONS=-c default_transaction_read_only=on",
      "macro-cgc-postgres-1",
      "psql",
      "-U",
      "user",
      "-d",
      "macrodb",
      "-Atc",
      query,
    ];
const processResult = Bun.spawnSync(command, {
  env: { ...process.env, PGOPTIONS: "-c default_transaction_read_only=on" },
});
if (processResult.exitCode !== 0) throw new Error("Read-only export failed");

type Row = Record<string, unknown>;
const rows = JSON.parse(processResult.stdout.toString()) as {
  messages: Row[];
  threads: Row[];
  reactions: Row[];
  attachments: Row[];
  mentions: Row[];
  channels: Row[];
};
const normalizeTime = (value: unknown) =>
  String(value ?? "2026-01-01T00:00:00Z");
const messages = new Map<string, Message>();
for (const row of rows.messages) {
  const id = String(row.id);
  const parent = {
    type: String(row.parent_entity_type),
    id: String(row.parent_entity_id),
  };
  const message: Message = {
    id,
    parent,
    kind: row.kind === "call_root" ? "call_root" : "message",
    sender_id: String(row.sender_id),
    content: String(row.content ?? ""),
    mentions: [],
    attachments: [],
    reactions: [],
    created_at: normalizeTime(row.created_at),
    updated_at: normalizeTime(row.updated_at),
  };
  if (row.thread_id) message.thread_id = String(row.thread_id);
  if (row.deleted_at) message.deleted_at = normalizeTime(row.deleted_at);
  if (row.edited_at) message.edited_at = normalizeTime(row.edited_at);
  if (row.guest_name) message.guest_name = String(row.guest_name);
  if (row.imported_author)
    message.imported_author = { name: String(row.imported_author) };
  messages.set(id, message);
}
for (const row of rows.reactions) {
  const message = messages.get(String(row.message_id));
  if (!message) continue;
  const emoji = String(row.emoji);
  let reaction = message.reactions.find((item) => item.emoji === emoji);
  if (!reaction) {
    reaction = { emoji, users: [] };
    message.reactions.push(reaction);
  }
  reaction.users.push(String(row.user_id));
}
for (const row of rows.attachments) {
  messages.get(String(row.message_id))?.attachments.push({
    id: String(row.id),
    entity_type: String(row.entity_type),
    entity_id: String(row.entity_id),
    created_at: normalizeTime(row.created_at),
  });
}
for (const row of rows.mentions) {
  messages.get(String(row.source_entity_id))?.mentions.push({
    entity_type: String(row.entity_type),
    entity_id: String(row.entity_id),
  });
}
const threads: Thread[] = [];
const channelTypes = new Map(
  rows.channels.map((row) => [String(row.id), String(row.channel_type)]),
);
const labels: Record<string, string> = {};
for (const row of rows.threads) {
  const rootId = String(row.root_id);
  const root = messages.get(rootId);
  if (!root) continue;
  const replies = [...messages.values()]
    .filter((message) => message.thread_id === rootId)
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
  threads.push({
    root,
    replies,
    state: {
      root_id: rootId,
      user_id: String(row.user_id),
      anchor: null,
      resolved: Boolean(row.resolved),
      created_at: normalizeTime(row.created_at),
      updated_at: normalizeTime(row.updated_at),
    },
  });
  if (root.parent.type === "channel") {
    labels[rootId] =
      channelTypes.get(root.parent.id) === "direct_message" ? "dm" : "channel";
  } else {
    labels[rootId] = root.parent.type;
  }
}
const corpus: Corpus = {
  viewerId:
    threads.find(
      (thread) =>
        thread.root.sender_id.startsWith("macro|") &&
        thread.root.sender_id.includes("@") &&
        !thread.root.deleted_at,
    )?.root.sender_id ?? generated().viewerId,
  threads,
  labels,
};
const outputFile = openSync(
  output,
  constants.O_WRONLY |
    constants.O_CREAT |
    constants.O_TRUNC |
    constants.O_NOFOLLOW,
  0o600,
);
try {
  fchmodSync(outputFile, 0o600);
  writeFileSync(outputFile, JSON.stringify(corpus));
} finally {
  closeSync(outputFile);
}
console.log(
  JSON.stringify({ threads: threads.length, messages: messages.size, output }),
);
