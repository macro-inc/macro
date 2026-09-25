import { PrStatusIcon } from '@block-pr/component/PrStatus';
import { MagicChipView } from '@core/component/LexicalMarkdown/component/decorator/MagicChip/MagicChipView';
import GitMerge from '@phosphor/git-merge.svg';
import { Button } from '@ui/components/Button';
import { createSignal, lazy, Show, Suspense } from 'solid-js';
import { DEPLOY_RESULT, DEPLOY_SESSION_ID } from '../core/deploy-agent-demo';
import { HomepageConversation } from './HomepageConversation';
import './homepage-agent-trace.css';

const AgentTrace = lazy(() => import('./HomepageAgentTrace'));

export default function HomepagePullRequest() {
  const [view, setView] = createSignal<'trace' | 'pr'>();
  const [merged, setMerged] = createSignal(false);
  let host!: HTMLDivElement;
  let opener: HTMLElement | undefined;
  const open = (next: 'trace' | 'pr', trigger?: HTMLElement) => {
    opener =
      trigger ??
      (document.activeElement instanceof HTMLElement &&
      host.contains(document.activeElement)
        ? document.activeElement
        : (host.querySelector<HTMLElement>('[data-magic-chip]') ?? undefined));
    setView(next);
  };
  const prLink = () => (
    <button
      type="button"
      class="homepage-agent-pr-link"
      aria-label="View pull request #482"
      aria-haspopup="dialog"
      onClick={(event) => open('pr', event.currentTarget)}
    >
      <PrStatusIcon
        status={merged() ? 'merged' : 'open'}
        class="size-4 shrink-0"
      />
      <span>PR #482</span>
    </button>
  );
  return (
    <div ref={host} class="homepage-agent-story">
      <HomepageConversation
        messages={[
          {
            person: 'teo',
            text: (
              <>
                I’ve started {prLink()} to fix the flaky deploy pipeline.{' '}
                <span class="homepage-person-mention">@Cursor</span>,
                investigate the failures and build the fix on this branch.
              </>
            ),
          },
          {
            person: 'cursor',
            text: 'On it. I’ll work on your branch, fix the failures, and run the tests.',
            reply: (
              <>
                <span class="homepage-agent-reply-label">Reply to Cursor</span>
                <div class="homepage-agent-chip glass">
                  <MagicChipView
                    agentSessionId={DEPLOY_SESSION_ID}
                    header={{ agent: 'Cursor Agent', model: 'Auto' }}
                    presentation={{ kind: 'settled', markdown: DEPLOY_RESULT }}
                    pullRequest={prLink()}
                    headerActions={
                      <Button
                        variant="success"
                        size="sm"
                        class="homepage-agent-merge"
                        aria-label={
                          merged()
                            ? 'Sample pull request merged'
                            : 'Merge sample pull request'
                        }
                        disabled={merged()}
                        onClick={() => setMerged(true)}
                      >
                        <GitMerge class="size-3.5" />
                        {merged() ? 'Merged' : 'Merge'}
                      </Button>
                    }
                    onOpen={() => open('trace')}
                  />
                </div>
                <span class="homepage-agent-trace-hint">
                  Open to explore the full agent trace
                </span>
              </>
            ),
          },
        ]}
      />
      <Show when={view()}>
        <Suspense>
          <AgentTrace
            view={view() ?? 'trace'}
            merged={merged()}
            onView={setView}
            onClose={() => setView(undefined)}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              opener?.focus({ preventScroll: true });
            }}
          />
        </Suspense>
      </Show>
    </div>
  );
}
