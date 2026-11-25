/**
 * Emails the agent has drafted and shown its owner, waiting for their
 * approval. One file per draft, in the run bucket: a pending send is like a
 * queue entry, and mail content is not kept in the repository. A draft lost
 * to a restart is drafted again.
 */
import { z } from 'zod';
import { type Disk, readJson, writeJson } from '../../context/disk.ts';

export const Draft = z.object({
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
  /** When it was shown, ISO 8601: an approval quoting its id comes after. */
  at: z.string(),
  /** What went out, once it did. */
  sent: z
    .object({ id: z.string(), threadId: z.string().optional() })
    .optional(),
});
export type Draft = z.infer<typeof Draft>;

export type Drafts = {
  /** A new draft's id. */
  readonly id: () => string;
  readonly read: (id: string) => Promise<Draft | undefined>;
  readonly write: (draft: Draft) => Promise<void>;
};

/** A draft id is a UUID: anything else names no draft, and never a path. */
const draftId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isDraftId = (id: string): boolean => draftId.test(id);

const extension = '.json';

export const draftStore = ({
  directory,
  join,
  disk,
  id,
}: {
  readonly directory: string;
  readonly join: (...parts: readonly string[]) => string;
  readonly disk: Pick<Disk, 'read' | 'write'>;
  readonly id: () => string;
}): Drafts => ({
  id,
  read: async (wanted) =>
    isDraftId(wanted)
      ? readJson(disk, join(directory, `${wanted}${extension}`), Draft)
      : undefined,
  write: (draft) => {
    if (!isDraftId(draft.id)) throw new Error(`not a draft id: ${draft.id}`);
    return writeJson(disk, join(directory, `${draft.id}${extension}`), draft);
  },
});
