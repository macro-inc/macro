import { z } from 'zod';

/** What a message carries besides its text: a forwarded email can arrive with no text at all. */
export const Attachment = z.object({ type: z.string(), id: z.string() });
export type Attachment = z.infer<typeof Attachment>;

/** One Macro message, as the agent records it in a conversation's history. */
export const Entry = z.object({
  id: z.string(),
  /** The conversation the message belongs to: its own id for a root, the root's for a reply. */
  root: z.string().nullish(),
  /** The root's id for a reply; null for a root. */
  thread: z.string().nullable(),
  dm: z.boolean(),
  /** The sender's display name. Never proof of who sent it. */
  from: z.string(),
  /** Macro's id for the sender, e.g. `macro|owner@example.com`. The only thing that says who sent it. */
  sender_id: z.string(),
  at: z.string(),
  text: z.string(),
  attachments: z.array(Attachment).optional(),
});
export type Entry = z.infer<typeof Entry>;

/** A message as it arrives: its entry, where it was posted, and who it mentions. */
export const Incoming = z.object({
  channelId: z.string(),
  /** The channel's name. */
  channel: z.string(),
  entry: Entry,
  /** The ids of everything the message mentions. */
  mentions: z.array(z.string()),
});
export type Incoming = z.infer<typeof Incoming>;

/** A message the agent decided is for it, waiting for its reply. */
export const Queued = Entry.extend({
  channel_id: z.string(),
  channel: z.string(),
  mentioned: z.boolean(),
  /** The relevance screen's probabilities. */
  p: z.record(z.string(), z.number()),
});
export type Queued = z.infer<typeof Queued>;

/** The messages of one conversation that the agent answers together. */
export const Conversation = z.object({
  channelId: z.string(),
  channel: z.string(),
  messages: z.array(Queued),
});
export type Conversation = z.infer<typeof Conversation>;

/** The source that carries conversations to the handler that wakes the agent to reply. */
export const conversationsSource = 'conversations';
