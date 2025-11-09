import { usePaywallState } from '@core/constant/PaywallState';
import { useUserQuotaQuery } from '@service-auth/userQuota';
import { createMemo, Suspense } from 'solid-js';

const BasicTierLimitWrapper = () => {
  const { showPaywall } = usePaywallState();
  const userQuota = useUserQuotaQuery();
  const MAX_DOCUMENTS = () => userQuota.data?.max_documents;
  const MAX_AI_CHAT_MESSAGES = () => userQuota.data?.max_ai_chat_messages;
  const documentCount = createMemo(() => userQuota.data?.documents);
  const aiChatsCount = createMemo(() => userQuota.data?.ai_chat_messages);

  return (
    <div class="flex items-center h-full border-t border-t-edge-muted px-1 text-sm font-mono">
      <span
        class="p-0.5 px-2 border border-accent/30 border-r-0 text-[0.625rem] text-accent uppercase font-mono"
        onClick={() => showPaywall(null)}
      >
        Guest Plan
      </span>
      <button
        class="font-mono uppercase text-xs bg-accent border border-accent p-px px-2 text-panel font-semibold hover:opacity-50"
        onClick={() => showPaywall(null)}
      >
        Upgrade
      </button>
      <div class="text-ink/50 px-1">
        [<span class="text-ink">{documentCount()}</span>
        <span>/{MAX_DOCUMENTS()}</span>]<span class="font-sans">Documents</span>
      </div>

      <span class="opacity-50">|</span>

      <div class="text-ink/50 px-1">
        [<span class="text-ink">{aiChatsCount()}</span>
        <span>/{MAX_AI_CHAT_MESSAGES()}</span>]
        <span class="font-sans">AI Messages</span>
      </div>
    </div>
  );
};
export const BasicTierLimit = () => {
  return (
    <Suspense>
      <BasicTierLimitWrapper />
    </Suspense>
  );
};
