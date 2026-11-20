import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { setGlobalSplitManager } from '@app/signal/splitLayout';
import type {
  OpenWithSplitOptions,
  SplitContent,
  SplitManager,
} from '@components/app/split-layout/layoutManager';
import { UserContextProvider } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { ImperativeDialogHost } from '@ui';
import { render } from 'solid-js/web';
import { buildConfig } from '../../../builder/MarkdownConfigBuilder';
import { MarkdownShell } from '../../../builder/MarkdownShell';
import { initializeLexical } from '../../../init';
import { StaticMarkdown, StaticMarkdownContext } from '../StaticMarkdown';

declare global {
  interface Window {
    openedSplits: { content: SplitContent; options?: OpenWithSplitOptions }[];
  }
}

initializeLexical();

queryClient.setQueryData(authKeys.userInfo.queryKey, {
  authenticated: true,
  email: 'viewer@example.com',
});

// Records the sessions a run opens; the real layout is out of scope here.
window.openedSplits = [];
setGlobalSplitManager({
  activeSplitId: () => undefined,
  openWithSplit: (content: SplitContent, options?: OpenWithSplitOptions) => {
    window.openedSplits.push({ content, options });
    return { split: undefined };
  },
} as unknown as SplitManager);

const PROMPT =
  'I am joining the team. Turn the onboarding guide into tasks for me.\n\nOne task per row in the checklist.';

const MESSAGE = `Try this:\n\n\`\`\`prompt\n${PROMPT}\n\`\`\``;

const DOCUMENT = [
  'Onboarding',
  '',
  '```plaintext',
  'Summarize my week',
  '```',
  '',
  '',
].join('\n');

function Fixture() {
  document.documentElement.dataset.touchDevice = String(isTouchDevice());
  const documentEditor = buildConfig('markdown')
    .namespace('prompt-blocks-document')
    .withActions()
    .withCode({ promptBlocks: true });
  const emailEditor = buildConfig('markdown')
    .namespace('prompt-blocks-email')
    .withCode();
  return (
    <StaticMarkdownContext>
      <main class="h-dvh overflow-y-auto p-6 bg-page text-ink max-w-2xl space-y-6">
        <section data-testid="message" class="space-y-2">
          <h2>Message</h2>
          <StaticMarkdown markdown={MESSAGE} />
        </section>
        <section data-testid="email" class="space-y-2">
          <h2>Email</h2>
          <StaticMarkdown markdown={MESSAGE} promptBlocks={false} />
        </section>
        <section data-testid="document" class="space-y-2">
          <h2>Document</h2>
          <MarkdownShell
            config={documentEditor}
            initialValue={DOCUMENT}
            ariaLabel="Document"
          />
        </section>
        <section data-testid="email-composer" class="space-y-2">
          <h2>Email composer</h2>
          <MarkdownShell
            config={emailEditor}
            initialValue={'```plaintext\nHello\n```'}
            ariaLabel="Email body"
          />
        </section>
      </main>
    </StaticMarkdownContext>
  );
}

render(
  () => (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <QueryClientProvider client={queryClient}>
          <UserContextProvider>
            <Fixture />
            <ImperativeDialogHost />
          </UserContextProvider>
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  ),
  document.getElementById('root')!
);
