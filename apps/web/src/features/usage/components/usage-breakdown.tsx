import BrainIcon from '@phosphor/brain.svg';
import ChatCircleDotsIcon from '@phosphor/chat-circle-dots.svg';
import FileTextIcon from '@phosphor/file-text.svg';
import FlaskIcon from '@phosphor/flask.svg';
import { cn } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import type { UsageSummary } from '../core/usage';
import { formatCreditBalance } from '../core/usage';

type UsageCategory = {
  id: string;
  label: string;
  description: string;
  icon: typeof BrainIcon;
  bgClass: string;
  textClass: string;
};

const USAGE_CATEGORIES: UsageCategory[] = [
  {
    id: 'agent',
    label: 'AI Agent Chats',
    description: 'Conversations with AI assistants',
    icon: ChatCircleDotsIcon,
    bgClass: 'bg-blue-bg',
    textClass: 'text-blue-ink',
  },
  {
    id: 'document',
    label: 'Document Editing',
    description: 'AI-powered writing and editing',
    icon: FileTextIcon,
    bgClass: 'bg-purple-bg',
    textClass: 'text-purple-ink',
  },
  {
    id: 'memory',
    label: 'AI Memory',
    description: 'Context and memory operations',
    icon: BrainIcon,
    bgClass: 'bg-green-bg',
    textClass: 'text-green-ink',
  },
  {
    id: 'other',
    label: 'Other AI Features',
    description: 'Search, suggestions, and more',
    icon: FlaskIcon,
    bgClass: 'bg-orange-bg',
    textClass: 'text-orange-ink',
  },
];

export function UsageBreakdown(props: { summary: UsageSummary | undefined }) {
  const usedPercent = createMemo(() => props.summary?.monthlyPercent ?? 0);

  const remainingPercent = createMemo(() => Math.max(0, 100 - usedPercent()));

  return (
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-2">
        <h3 class="text-sm font-medium text-ink">What counts toward usage</h3>
        <p class="text-xs text-ink-muted leading-relaxed">
          Your monthly usage is measured in API cost — determined by the AI
          model you use, the length of your conversations, and the size of
          documents processed.
        </p>
      </div>

      <div class="grid grid-cols-2 gap-3 @[480px]:grid-cols-4">
        <For each={USAGE_CATEGORIES}>
          {(category) => (
            <div class="flex flex-col gap-2 rounded-lg border border-edge-muted p-3">
              <div class="flex items-center gap-2">
                <div
                  class={cn(
                    'flex size-6 items-center justify-center rounded',
                    category.bgClass,
                    category.textClass
                  )}
                >
                  <category.icon class="size-3.5" />
                </div>
                <span class="text-xs font-medium text-ink truncate">
                  {category.label}
                </span>
              </div>
              <p class="text-xs text-ink-muted line-clamp-2">
                {category.description}
              </p>
            </div>
          )}
        </For>
      </div>

      <Show when={props.summary && !props.summary.unlimited}>
        <div class="flex flex-col gap-3 rounded-lg border border-edge-muted p-4">
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm font-medium text-ink">This period</span>
            <span class="text-sm text-ink-muted">
              {Math.round(usedPercent())}% of allowance used
            </span>
          </div>
          <div class="flex h-3 w-full overflow-hidden rounded-full bg-active">
            <div
              class={cn(
                'h-full transition-[width]',
                usedPercent() >= 100 ? 'bg-failure' : 'bg-accent'
              )}
              style={{ width: `${Math.min(100, usedPercent())}%` }}
            />
            <Show when={remainingPercent() > 0}>
              <div
                class="h-full bg-ink/5"
                style={{ width: `${remainingPercent()}%` }}
              />
            </Show>
          </div>
          <div class="flex justify-between text-xs text-ink-muted">
            <span>Allowance included with your plan</span>
            <Show
              when={props.summary?.creditBalanceCents}
              fallback={<span>{remainingPercent()}% remaining</span>}
            >
              <span>
                + {formatCreditBalance(props.summary!.creditBalanceCents)}{' '}
                credits
              </span>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
