import { makePersistedState } from '@app/lib/persistence';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createStore } from 'solid-js/store';
import { z } from 'zod';

const contentSchema = z.object({
  text: z.string().default(''),
  replyTo: z.string().optional(),
  attachment: z
    .object({
      document_id: z.string(),
      filename: z.string(),
      kind: z.enum(['image', 'audio', 'video', 'document']),
    })
    .optional(),
  templateMode: z.boolean().default(false),
  templateId: z.string().default(''),
  // Tolerate drafts saved with gaps so the rest of the draft still restores.
  parameters: z
    .array(z.preprocess((value) => value ?? '', z.string()))
    .default([]),
  humanSupport: z.boolean().default(false),
  uncertainReply: z.boolean().default(false),
  intent: z.string().uuid().optional(),
});

const replyDraftSchema = contentSchema.extend({
  submitted: contentSchema
    .extend({
      intent: z.string().uuid(),
      templateLanguage: z.string().optional(),
    })
    .optional(),
});
export type ReplyDraftContent = z.infer<typeof contentSchema>;
export const snapshotReplyDraft = (draft: ReplyDraftContent) =>
  contentSchema.parse(draft);
export const emptyReplyDraft = () => replyDraftSchema.parse({});

/** A draft and its retry identity belong to one signed-in user and customer. */
export function createReplyDraft(
  userId: string | undefined,
  channelId: string,
  accountScope?: string
) {
  const storage = createUserScopedStorage(
    `macro:meta-reply:v1:${encodeURIComponent(channelId)}${accountScope ? `:${encodeURIComponent(accountScope)}` : ''}`
  );
  return makePersistedState(createStore(emptyReplyDraft()), {
    storages: {
      restore: () => {
        if (!userId) return;
        const raw = storage.read(userId);
        if (!raw) return;
        try {
          const result = replyDraftSchema.safeParse(JSON.parse(raw));
          return result.success ? result.data : undefined;
        } catch {
          return;
        }
      },
      write: (value) => {
        if (userId) storage.write(userId, JSON.stringify(value));
      },
    },
  });
}
