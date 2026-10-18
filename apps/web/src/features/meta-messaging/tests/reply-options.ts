import type { MetaConversationView } from '@service-storage/generated/schemas/metaConversationView';
import type { ReplyMode } from '@service-storage/generated/schemas/replyMode';

export function replyOptions(
  provider: MetaConversationView['provider'] = 'whatsapp'
): Pick<MetaConversationView, 'capabilities' | 'eligibility'> {
  const modes: ReplyMode[] =
    provider === 'whatsapp'
      ? ['free_form', 'approved_template']
      : ['free_form', 'human_support'];
  return {
    capabilities: {
      modes,
      text_limit: provider === 'whatsapp' ? 4096 : 1000,
      text_limit_in_bytes: provider === 'instagram',
      media: [],
      max_attachments: 1,
    },
    eligibility: {
      evaluated_at: new Date().toISOString(),
      modes: modes.map((mode) => ({
        mode,
        allowed: mode !== 'human_support',
        reason: mode === 'human_support' ? 'human_support_required' : null,
        expires_at:
          mode === 'free_form'
            ? new Date(Date.now() + 3600000).toISOString()
            : null,
      })),
    },
  };
}
