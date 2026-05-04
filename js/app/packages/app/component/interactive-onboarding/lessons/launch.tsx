import { createSignal, For, onMount, Show } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import AppStoreQr from '@macro-icons/app-store.svg';
import CaretRight from '@phosphor-icons/core/bold/caret-right-bold.svg?component-solid';
import CheckIcon from '@phosphor-icons/core/bold/check-bold.svg?component-solid';
import ClipboardIcon from '@phosphor-icons/core/bold/clipboard-bold.svg?component-solid';
import { Button, SegmentedControl } from '@ui';
import {
  CLI_COMMANDS,
  MACRO_MCP_CONFIG,
  MACRO_MCP_URL,
  WEB_CLIENTS,
} from '@core/component/AI/component/AIChatEmptyState';
import type { LessonContentProps, LessonDefinition } from '../types';
import { useAnalytics } from '@app/component/analytics-context';
import { useUserId } from '@core/context/user';
import { ENABLE_APP_STORE_QR_CODE } from '@core/constant/featureFlags';
import {
  SIGNUP_LEAD_VALUE_BY_TIER,
  SIGNUP_LEAD_VALUE_DEFAULT,
} from '@app/lib/analytics/leadValues';

function LaunchContent(props: LessonContentProps) {
  const analytics = useAnalytics();
  const [searchParams] = useSearchParams();
  const userId = useUserId();

  onMount(() => {
    // `type` is set on the Stripe success redirect (see choose-plan.tsx). Free
    // users skip Stripe entirely so the param is absent — default to 'free'.
    const rawTier = searchParams.type;
    const tier = (Array.isArray(rawTier) ? rawTier[0] : rawTier) ?? 'free';
    const value = SIGNUP_LEAD_VALUE_BY_TIER[tier] ?? SIGNUP_LEAD_VALUE_DEFAULT;
    analytics.trackMeta('CompleteRegistration', {
      content_name: 'onboarding_launch',
      content_category: tier,
      value,
      currency: 'USD',
    });
    analytics.trackGoogleConversion('signup', {
      value,
      currency: 'USD',
      transaction_id: userId(),
    });
    setTimeout(() => props.onComplete('Launch'));
  });

  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      {ENABLE_APP_STORE_QR_CODE ? (
        <>
          <p>You're all set!</p>
          <p>
            Before you dive in, install our mobile iOS app or connect Macro to
            your favorite AI tools via MCP.
          </p>
          <p>Both are always accessible from the settings panel.</p>
        </>
      ) : (
        <p>You're all set! Let's dive in.</p>
      )}
    </div>
  );
}

type LaunchTab = 'mobile' | 'mcp';

const LAUNCH_TAB_OPTIONS: Array<{ value: LaunchTab; label: string }> = [
  { value: 'mobile', label: 'Mobile app' },
  { value: 'mcp', label: 'MCP instructions' },
];

function MobilePanel() {
  return (
    <div class="h-full w-full flex flex-col items-center justify-center gap-6">
      <AppStoreQr class="w-[55cqw] h-[55cqw] max-w-[460px] max-h-[460px]" />
      <p class="text-ink font-medium text-center">
        Download on the
        <br />
        <a
          href="https://apps.apple.com/us/app/macro-app/id6743133649"
          rel="noopener noreferrer"
          class="underline"
          target="_blank"
        >
          App Store
        </a>
      </p>
    </div>
  );
}

function CollapsibleCard(props: {
  label: string;
  hint?: string;
  copyKey: string;
  copyValue: string;
  copyLabel?: string;
  copiedKey: () => string | null;
  onCopy: (key: string, text: string) => void;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const isCopied = () => props.copiedKey() === props.copyKey;

  return (
    <div class="overflow-hidden rounded-md border border-edge-muted bg-input/70">
      <button
        type="button"
        class="flex items-center gap-2 w-full px-4 py-2 text-left"
        aria-expanded={expanded()}
        onClick={() => setExpanded((v) => !v)}
      >
        <CaretRight
          class="size-3 shrink-0 text-ink-muted transition-transform"
          classList={{ 'rotate-90': expanded() }}
        />
        <span class="text-sm text-ink-muted truncate">{props.label}</span>
      </button>
      <Show when={expanded()}>
        <div class="border-t border-edge-muted flex flex-col">
          <Show when={props.hint}>
            <div class="px-4 pt-3 text-xs text-ink-extra-muted">
              {props.hint}
            </div>
          </Show>
          <div class="flex items-start justify-between gap-3 px-4 py-3">
            <pre class="flex-1 min-w-0 overflow-x-auto text-[12px] leading-5 text-ink select-text cursor-text whitespace-pre-wrap break-all">
              <code>{props.copyValue}</code>
            </pre>
            <Button
              variant={isCopied() ? 'secondary' : 'ghost'}
              size="sm"
              class="shrink-0"
              onClick={() => props.onCopy(props.copyKey, props.copyValue)}
            >
              {isCopied() ? (
                <>
                  <CheckIcon class="size-3.5" />
                  Copied
                </>
              ) : (
                <>
                  <ClipboardIcon class="size-3.5" />
                  {props.copyLabel ?? 'Copy'}
                </>
              )}
            </Button>
          </div>
        </div>
      </Show>
    </div>
  );
}

function McpPanel() {
  const [copiedKey, setCopiedKey] = createSignal<string | null>(null);

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(
        () => setCopiedKey((current) => (current === key ? null : current)),
        2000
      );
    } catch (err) {
      console.error('Failed to copy MCP setup instructions', err);
    }
  };

  return (
    <div class="w-full max-w-2xl flex flex-col gap-3">
      <For each={CLI_COMMANDS}>
        {(item) => (
          <CollapsibleCard
            label={item.label}
            copyKey={item.key}
            copyValue={item.command}
            copiedKey={copiedKey}
            onCopy={handleCopy}
          />
        )}
      </For>

      <For each={WEB_CLIENTS}>
        {(item) => (
          <CollapsibleCard
            label={item.label}
            hint={item.hint}
            copyKey={item.key}
            copyValue={MACRO_MCP_URL}
            copyLabel="Copy URL"
            copiedKey={copiedKey}
            onCopy={handleCopy}
          />
        )}
      </For>

      <CollapsibleCard
        label="IDE"
        copyKey="json"
        copyValue={MACRO_MCP_CONFIG}
        copiedKey={copiedKey}
        onCopy={handleCopy}
      />
    </div>
  );
}

function LaunchDemo() {
  const [tab, setTab] = createSignal<LaunchTab>('mobile');

  return (
    <div class="h-full w-full flex flex-col items-center px-8 py-8 @container">
      <SegmentedControl
        value={tab()}
        options={LAUNCH_TAB_OPTIONS}
        onChange={setTab}
        aria-label="Launch options"
      />
      <div class="flex-1 w-full min-h-0 mt-6 flex items-start justify-center overflow-y-auto">
        <Show when={tab() === 'mobile'} fallback={<McpPanel />}>
          <MobilePanel />
        </Show>
      </div>
    </div>
  );
}

export const launchLesson: LessonDefinition = {
  id: 'launch',
  title: 'Welcome to Macro',
  content: LaunchContent,
  ...(ENABLE_APP_STORE_QR_CODE && { demo: LaunchDemo, centeredButton: true }),
  order: 100,
};
