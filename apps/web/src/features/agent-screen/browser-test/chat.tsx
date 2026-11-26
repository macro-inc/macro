import '@fontsource-variable/inter';
import '@app/index.css';
import { AgentReplyLinks } from '@components/app/split-layout/split-router/agent-reply-links';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { harnessKeys } from '@queries/harnesses/keys';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { render } from 'solid-js/web';
import { macroDarkTheme } from '../../theme/themes/macro-dark';
import { macroLightTheme } from '../../theme/themes/macro-light';
import { AGENT } from './stubs/dm';

/**
 * An agent's chat reply with links to computer screens: one the viewer may
 * watch, one not in their list, a malformed one and one on another site.
 * `?theme=dark`.
 */
const params = new URLSearchParams(location.search);
document.documentElement.dataset.themeLight = String(
  params.get('theme') !== 'dark'
);
const theme = params.get('theme') === 'dark' ? macroDarkTheme : macroLightTheme;
for (const [token, value] of Object.entries(theme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}

const KNOWN = '01a1ff9c-c73e-7c62-8c23-20a668f2f355';
const UNKNOWN = '01a1ff9c-0000-7000-8000-000000000000';

// Nothing here may reach a backend; the harness list is the viewer's.
const queryClient = new QueryClient({
  defaultOptions: { queries: { enabled: false, retry: false } },
});
queryClient.setQueryData(harnessKeys.list.queryKey, [
  { id: KNOWN, team_agent_user_id: AGENT, access: 'view', name: 'computer' },
]);

const here = location.origin;
const markdown = [
  `I need you for a check: [open my screen](${here}/app/screen/${KNOWN}?mode=drive), then hand it back.`,
  '',
  `Unknown: ${here}/app/screen/${UNKNOWN}`,
  '',
  `Malformed: [broken](${here}/app/screen/not-a-harness)`,
  '',
  `Elsewhere: [other site](https://example.com/app/screen/${KNOWN})`,
].join('\n');

const root = document.getElementById('root');
if (root)
  render(
    () => (
      <QueryClientProvider client={queryClient}>
        <div class="min-h-screen bg-page p-4 text-ink">
          <div
            data-testid="message"
            class="max-w-[640px] rounded-xl border border-edge-frame bg-panel p-4 text-base"
          >
            <AgentReplyLinks>
              <StaticMarkdown markdown={markdown} />
            </AgentReplyLinks>
          </div>
        </div>
      </QueryClientProvider>
    ),
    root
  );
