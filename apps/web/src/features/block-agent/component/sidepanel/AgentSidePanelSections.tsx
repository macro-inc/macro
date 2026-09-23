/**
 * The agent block's side-panel sections, in the repo's
 * `component/sidepanel/<X>SidePanelSections.tsx` convention (the PR block's
 * `PrSidePanelSections` is the template): a fragment of
 * `<SidePanel.Section>` elements that self-register into the enclosing
 * `<SidePanel.Layout>`.
 *
 * Session details and activity use the live fold; changed files and totals
 * use the shared PR changes controller.
 */

import { DiffCounts } from '@app/features/agent-changes/components/DiffCounts';
import { useOptionalAgentChanges } from '@app/features/agent-changes/context/agent-changes-controller';
import { SidePanel } from '@components/app/side-panel';
import { ModelIcon } from '@core/component/AI/component/ProviderIcon';
import { References } from '@core/component/References';
import { formatDate } from '@core/util/date';
import { openExternalUrl } from '@core/util/url';
import GitBranch from '@phosphor/git-branch.svg';
import { useAttachmentReferencesQuery } from '@queries/storage/attachment-references';
import { createMemo, For, Show, Suspense } from 'solid-js';
import { useAgentSession } from '../../context/AgentSessionContext';
import { sessionStatus } from '../../state/session-status';
import { activityCounts, latestPlan } from '../../state/session-summary';
import { CountSummary, SessionStatusPill, TodoList } from '../../ui';
import { AgentPullRequestChip } from '../AgentPullRequestChip';
import {
  modelDisplayName,
  sessionHarnessTitle,
  sessionRepositoryUrl,
  showsSessionHarness,
} from '../compose-agent-session-options';

export function AgentSidePanelSections() {
  const { sessionId, session, bot, metadata, messages } = useAgentSession();

  const plan = createMemo(() => latestPlan(messages()));
  const changes = useOptionalAgentChanges();
  const files = () => changes?.model.files() ?? [];
  const activity = createMemo(() => activityCounts(messages()));
  const totals = () => changes?.changeCounts();

  return (
    <>
      <SidePanel.Section id="details" title="Details" defaultOpen order={10}>
        <SidePanel.Grid>
          <SidePanel.Row label="Status">
            <SessionStatusPill status={sessionStatus(metadata())} />
          </SidePanel.Row>
          <Show when={bot()?.name}>
            {(name) => (
              <SidePanel.Row label="Agent">
                <SidePanel.Pill>
                  <span class="truncate">{name()}</span>
                </SidePanel.Pill>
              </SidePanel.Row>
            )}
          </Show>
          <Show when={showsSessionHarness(session() ?? {})}>
            <SidePanel.Row label="Harness">
              <SidePanel.Pill>
                <span class="truncate">
                  {sessionHarnessTitle(session() ?? {})}
                </span>
              </SidePanel.Pill>
            </SidePanel.Row>
          </Show>
          <Show when={metadata()?.model ?? session()?.model}>
            {(model) => (
              <SidePanel.Row label="Model">
                <SidePanel.Pill>
                  <ModelIcon model={model()} class="size-3" />
                  <span class="truncate">
                    {modelDisplayName(
                      model(),
                      metadata()?.supportedModels ?? []
                    )}
                  </span>
                </SidePanel.Pill>
              </SidePanel.Row>
            )}
          </Show>
          <Show when={sessionRepositoryUrl(session())}>
            {(url) => (
              <SidePanel.Row label="Repository">
                <button
                  type="button"
                  class={`${SidePanel.pillClass} hover:bg-hover`}
                  onClick={() => openExternalUrl(url())}
                >
                  <GitBranch class="size-3 shrink-0" />
                  <span class="truncate">{repoName(url())}</span>
                </button>
              </SidePanel.Row>
            )}
          </Show>
          <Show when={session()?.pullRequestUrl}>
            {(url) => (
              <SidePanel.Row label="Pull request">
                <AgentPullRequestChip url={url()} />
              </SidePanel.Row>
            )}
          </Show>
          <Show when={session()?.createdAt}>
            {(created) => (
              <SidePanel.Row label="Created">
                <SidePanel.Pill>
                  <span class="truncate">
                    {formatDate(created(), { showTime: true })}
                  </span>
                </SidePanel.Pill>
              </SidePanel.Row>
            )}
          </Show>
          <Show when={session()?.modifiedAt}>
            {(modified) => (
              <SidePanel.Row label="Last updated">
                <SidePanel.Pill>
                  <span class="truncate">
                    {formatDate(modified(), { showTime: true })}
                  </span>
                </SidePanel.Pill>
              </SidePanel.Row>
            )}
          </Show>
        </SidePanel.Grid>
      </SidePanel.Section>

      <Show when={plan()}>
        {(entries) => (
          <SidePanel.Section id="plan" title="Plan" defaultOpen order={15}>
            <TodoList
              todos={entries().map((entry) => ({
                content: entry.content,
                status: entry.status,
              }))}
            />
          </SidePanel.Section>
        )}
      </Show>

      <Show when={files().length > 0}>
        <SidePanel.Section
          id="files"
          title={
            <SidePanel.CountTitle
              label="Changed files"
              count={files().length}
            />
          }
          defaultOpen
          order={20}
          actions={
            <Show when={totals()}>
              {(counts) => <DiffCounts {...counts()} />}
            </Show>
          }
        >
          <div class="flex flex-col gap-1">
            <For each={files()}>
              {(file) => (
                <div class="flex items-center gap-2 text-xs">
                  <span
                    class="min-w-0 flex-1 truncate text-ink"
                    title={file.path}
                  >
                    {file.path}
                  </span>
                  <DiffCounts
                    additions={file.additions}
                    deletions={file.deletions}
                  />
                </div>
              )}
            </For>
          </div>
        </SidePanel.Section>
      </Show>

      <Show when={activity().some((item) => item.count > 0)}>
        <SidePanel.Section id="activity" title="Activity" order={30}>
          <div class="text-xs text-ink-muted">
            <CountSummary items={activity()} />
          </div>
        </SidePanel.Section>
      </Show>

      <ReferencesSectionConditional sessionId={sessionId()} />
    </>
  );
}

/**
 * Where this session is referenced: channel messages that mention or attach
 * it, and documents that mention it. Same section the markdown, email, and
 * call blocks show; hidden until at least one reference exists.
 */
function ReferencesSectionConditional(props: { sessionId?: string }) {
  const references = useAttachmentReferencesQuery(
    () => props.sessionId,
    () => 'agent_session'
  );

  // Gate the resource read on status so a pending query never suspends the
  // enclosing block while the section is hidden anyway.
  const count = () => (references.isSuccess ? references.data.length : 0);

  return (
    <Show when={count() > 0 ? props.sessionId : undefined}>
      {(sessionId) => (
        <SidePanel.Section
          id="references"
          title={<SidePanel.CountTitle label="References" count={count()} />}
          order={40}
        >
          <Suspense fallback={<SidePanel.Loading />}>
            <div class="text-xs">
              <References documentId={sessionId()} entityType="agent_session" />
            </div>
          </Suspense>
        </SidePanel.Section>
      )}
    </Show>
  );
}

/** `https://github.com/org/repo.git` → `org/repo` for a compact pill. */
function repoName(url: string): string {
  const path = url
    .replace(/\.git$/, '')
    .split('/')
    .filter(Boolean);
  const repo = path.at(-1);
  const org = path.at(-2);
  return org && repo && !org.includes(':') ? `${org}/${repo}` : (repo ?? url);
}
