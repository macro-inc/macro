import { createAIProjection } from '@queries/ai/projection';
import type { Accessor } from 'solid-js';
import type { EmailMessage } from '../../email-message/core/email-message';
import {
  buildSuggestedRepliesPrompt,
  suggestedRepliesSchema,
} from '../core/suggested-replies';

const FAST_MODEL = 'anthropic/claude-haiku-4-5';

export function createSuggestedReplies(args: {
  threadId: Accessor<string>;
  latestMessage: Accessor<EmailMessage>;
  viewerEmails: Accessor<string[]>;
  enabled: Accessor<boolean>;
  hasProfessionalFeatures: Accessor<boolean>;
}) {
  const isLatestMessageInbound = () => {
    const sender = args.latestMessage().from?.email.toLowerCase();
    const viewers = new Set(
      args.viewerEmails().map((email) => email.toLowerCase())
    );
    return !!sender && viewers.size > 0 && !viewers.has(sender);
  };
  const enabled = () => args.enabled() && isLatestMessageInbound();

  const projectionOptions = () => {
    const message = args.latestMessage();
    return {
      prompt: buildSuggestedRepliesPrompt(args.threadId(), message.db_id),
      schema: suggestedRepliesSchema,
      refreshCadence: 'medium',
      expiry: 'week',
    } as const;
  };

  const fast = createAIProjection(() => ({
    ...projectionOptions(),
    id: `email/suggested-replies-fast/${args.threadId()}/${args.latestMessage().db_id}`,
    model: FAST_MODEL,
    awaitGeneration: true,
    enabled: enabled(),
  }));

  const smart = createAIProjection(() => {
    return {
      ...projectionOptions(),
      id: `email/suggested-replies-smart/${args.threadId()}/${args.latestMessage().db_id}`,
      enabled: enabled() && args.hasProfessionalFeatures(),
    };
  });

  const repliesFrom = (projection: typeof fast) => {
    const result = projection.data();
    return typeof result === 'string' ? undefined : result?.replies;
  };
  const replies = () => repliesFrom(smart) ?? repliesFrom(fast);

  return {
    replies,
    isGenerating: () =>
      replies() === undefined &&
      (fast.isGenerating() ||
        (args.hasProfessionalFeatures() && smart.isGenerating())),
    error: () =>
      fast.error() ??
      (args.hasProfessionalFeatures() ? smart.error() : undefined),
    retry: async () => {
      const requests = [fast.refresh()];
      if (args.hasProfessionalFeatures()) requests.push(smart.refresh());
      await Promise.allSettled(requests);
    },
  };
}
