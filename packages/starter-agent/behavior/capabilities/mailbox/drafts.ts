/**
 * Emails the agent has drafted and shown its owner, waiting for their
 * approval. One file per draft, in the run
 * bucket: a pending send is like a queue entry, and mail content is not kept
 * in the repository. A draft lives a day; once sent, only what went out is
 * kept, for a day, so asking again answers without sending again.
 *
 * These files are not a security boundary: anything that can write the
 * agent's disk can change them. A send is checked against the draft's DM,
 * whose text carries the content's fingerprint, not against the file alone.
 */
import { z } from 'zod';
import { type Disk, readJson, writeJson } from '../../context/disk.ts';

/** How long a draft can be approved, and a sent one remembered. */
export const draftLifetime = Temporal.Duration.from({ hours: 24 });

export const Pending = z.object({
  state: z.literal('pending'),
  id: z.string(),
  /** A new message, or a reply to `replyTo`. */
  kind: z.enum(['new', 'reply']),
  to: z.array(z.string()),
  cc: z.array(z.string()),
  subject: z.string(),
  text: z.string(),
  replyTo: z.string().optional(),
  /** Whose approval it needs: the owner it was shown to. */
  owner: z.string(),
  /** The DM that showed it to them. */
  shown: z.object({ channelId: z.string(), messageId: z.string() }),
  /** When it was shown, ISO 8601. */
  at: z.string(),
});
export type Pending = z.infer<typeof Pending>;

export const SentDraft = z.object({
  state: z.literal('sent'),
  id: z.string(),
  kind: z.enum(['new', 'reply']),
  sent: z.object({ id: z.string(), threadId: z.string().optional() }),
  at: z.string(),
});
export type SentDraft = z.infer<typeof SentDraft>;

export const Draft = z.discriminatedUnion('state', [Pending, SentDraft]);
export type Draft = z.infer<typeof Draft>;

export type Drafts = {
  /** A new draft's id. */
  readonly id: () => string;
  readonly read: (id: string) => Promise<Draft | undefined>;
  readonly write: (draft: Draft) => Promise<void>;
  /** Removes drafts older than a draft's lifetime. */
  readonly prune: () => Promise<void>;
};

/** A draft id is a UUID: anything else names no draft, and never a path. */
const draftId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isDraftId = (id: string): boolean => draftId.test(id);

const extension = '.json';

/** Whether something recorded at `at` is older than a draft lives. */
export const expired = (at: string, now: Temporal.Instant): boolean =>
  Temporal.Instant.compare(Temporal.Instant.from(at).add(draftLifetime), now) <=
  0;

export const draftStore = ({
  directory,
  join,
  disk,
  id,
  now,
}: {
  readonly directory: string;
  readonly join: (...parts: readonly string[]) => string;
  readonly disk: Pick<Disk, 'read' | 'write' | 'list' | 'remove'>;
  readonly id: () => string;
  readonly now: () => Temporal.Instant;
}): Drafts => {
  const file = (name: string) => join(directory, `${name}${extension}`);
  return {
    id,
    read: async (wanted) =>
      isDraftId(wanted) ? readJson(disk, file(wanted), Draft) : undefined,
    write: (draft) => {
      if (!isDraftId(draft.id)) throw new Error('not a draft id');
      return writeJson(disk, file(draft.id), draft);
    },
    prune: async () => {
      const at = now();
      for (const name of await disk.list(directory)) {
        if (!name.endsWith(extension)) continue;
        const stem = name.slice(0, -extension.length);
        if (!isDraftId(stem)) continue;
        const draft = await readJson(disk, file(stem), Draft);
        if (draft === undefined || expired(draft.at, at))
          await disk.remove(file(stem));
      }
    },
  };
};
