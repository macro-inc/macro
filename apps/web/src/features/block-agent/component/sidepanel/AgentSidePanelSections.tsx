/**
 * The agent block's side-panel sections, in the repo's
 * `component/sidepanel/<X>SidePanelSections.tsx` convention (the PR block's
 * `PrSidePanelSections` is the template): a fragment of
 * `<SidePanel.Section>` elements that self-register into the enclosing
 * `<SidePanel.Layout>`.
 *
 * Everything rendered here is derived from state the block already holds —
 * the session record, the fold's metadata, and pure summaries over the
 * folded transcript (`state/session-summary.ts`).
 */

import { SidePanel, useSidePanel } from '@components/app/side-panel';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { formatDate } from '@core/util/date';
import { openExternalUrl } from '@core/util/url';
import GitBranch from '@phosphor/git-branch.svg';
import { createMemo, For, onCleanup, Show } from 'solid-js';
import { useAgentSession } from '../../context/AgentSessionContext';
import {
  activityCounts,
  changedFiles,
  latestPlan,
} from '../../state/session-summary';
import {
  CountSummary,
  DiffChanges,
  SessionStatusPill,
  TodoList,
} from '../../ui';
import { harnessTitle } from '../AgentSplitHeader';

export function AgentSidePanelSections() {
  const { session, bot, metadata, messages, status } = useAgentSession();

  const plan = createMemo(() => latestPlan(messages()));
  const files = createMemo(() => changedFiles(messages()));
  const activity = createMemo(() => activityCounts(messages()));
  const totals = createMemo(() => ({
    additions: files().reduce((sum, file) => sum + file.additions, 0),
    deletions: files().reduce((sum, file) => sum + file.deletions, 0),
  }));

  // `]` toggles the panel, registered at the split scope so it works from
  // anywhere in the split (the md block's TopBar registration, verbatim).
  const sidePanel = useSidePanel();
  const splitPanel = useSplitPanel();
  if (splitPanel?.splitHotkeyScope) {
    const reg = registerHotkey({
      hotkey: ']',
      scopeId: splitPanel.splitHotkeyScope,
      hotkeyToken: TOKENS.block.toggleSidePanel,
      description: 'Toggle Side Panel',
      keyDownHandler: () => {
        if (!sidePanel) return false;
        if (!sidePanel.hasSections()) return false;
        sidePanel.toggle();
        return true;
      },
    });
    onCleanup(() => reg.dispose());
  }

  return (
    <>
      <SidePanel.Section id="details" title="Details" defaultOpen order={10}>
        <SidePanel.Grid>
          <SidePanel.Row label="Status">
            <SessionStatusPill status={status()} />
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
          <SidePanel.Row label="Harness">
            <SidePanel.Pill>
              <span class="truncate">{harnessTitle(session()?.harness)}</span>
            </SidePanel.Pill>
          </SidePanel.Row>
          <Show when={metadata()?.model ?? session()?.model}>
            {(model) => (
              <SidePanel.Row label="Model">
                <SidePanel.Pill>
                  <span class="truncate">{model()}</span>
                </SidePanel.Pill>
              </SidePanel.Row>
            )}
          </Show>
          <Show when={session()?.repoUrl}>
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
          actions={<DiffChanges variant="bars" {...totals()} />}
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
                  <DiffChanges
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
    </>
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
