import { TextShimmer } from '@app/features/block-agent/ui';
import { parseGithubPrUrl, prHtmlUrl } from '@app/features/block-pr/util/prKey';
import { t } from '@app/lib/i18n';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSessionActivity } from '@core/agent-session/session-activity';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import type { AgentSessionEntity } from '@entity';
import FilledSparkleIcon from '@icon/system/fill/sparkle-fill.svg?component-solid';
import ArchiveIcon from '@icon/system/regular/archive.svg';
import RoutineIcon from '@icon/system/regular/clock-clockwise.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import { isSessionArchived } from '@service-agent-harness/session-archive';
import { Show } from 'solid-js';
import {
  AgentSessionCodeDetails,
  AgentSessionPullRequestStatus,
} from '../components/AgentSessionCodeDetails';
import {
  AgentSessionRow,
  AgentSessionStatusIndicator,
} from '../components/AgentSessionRow';
import { kindForHarness, modeForKind, systemBotKind } from '../core/agent-kind';
import { conversationState } from '../core/conversation-state';
import { compactAge } from '../core/format-age';
import type { AgentsMode } from '../core/mode';
import { conversationTimestamp } from '../core/recent-conversations';
import {
  repositoryLabel,
  type SessionCodeDetails,
} from '../core/session-code-details';

type Props = {
  entity: AgentSessionEntity;
  surface: 'home' | 'agents';
  active?: boolean;
  unread?: boolean;
  mode?: AgentsMode;
  onOpen?: (event: MouseEvent) => void;
};

/** Persisted list metadata stays fresh through the session update events. */
export function AgentSessionListItem(props: Props) {
  const { openWithSplit } = useSplitLayout();
  const mode = () =>
    props.entity.harness
      ? modeForKind(kindForHarness(props.entity.harness))
      : (props.mode ??
        modeForKind(systemBotKind(props.entity.botId) ?? 'agent'));
  const state = () =>
    conversationState(props.entity.status, props.entity.turnState);
  const failed = () => props.entity.turnState === 'failed';
  const activity = useSessionActivity(() => props.entity.id);
  const summary = () => (state() === 'working' ? activity() : undefined);
  const details = (): SessionCodeDetails | undefined => {
    if (mode() !== 'code') return undefined;
    const pr = parseGithubPrUrl(props.entity.pullRequestUrl ?? '');
    const repository =
      repositoryLabel(props.entity.repoUrl) ??
      (pr ? `${pr.owner}/${pr.repo}` : undefined);
    const branch = props.entity.workingBranch ?? undefined;
    if (!repository && !branch && !pr) return undefined;
    return {
      repository,
      branch,
      pullRequest: pr
        ? {
            number: pr.number,
            url: prHtmlUrl(pr),
            status: props.entity.pullRequestState ?? undefined,
          }
        : undefined,
    };
  };

  const agents = () => props.surface === 'agents';
  const openPullRequest = (event: MouseEvent) => {
    const id = props.entity.pullRequestId;
    if (!id) return;
    openWithSplit(
      { type: 'pr', id },
      { preferNewSplit: openInNewSplitForMention(event.shiftKey, true) }
    );
  };
  const onOpenPullRequest = () =>
    props.entity.pullRequestId ? openPullRequest : undefined;

  return (
    <AgentSessionRow
      id={props.entity.id}
      title={props.entity.name || 'Untitled conversation'}
      kind={mode()}
      state={state()}
      failed={failed()}
      active={props.active}
      unread={props.unread}
      hideLeading={agents()}
      onOpen={props.onOpen}
      timestamp={compactAge(conversationTimestamp(props.entity))}
      leading={
        <Show when={mode() === 'code'} fallback={<SparkleIcon />}>
          <FilledSparkleIcon />
        </Show>
      }
      trailing={
        <>
          <Show when={props.entity.source === 'routine'}>
            <RoutineIcon
              aria-hidden={false}
              aria-label="Routine run"
              class="size-3.5 shrink-0 text-ink-extra-muted"
            />
          </Show>
          <Show when={agents() && isSessionArchived(props.entity)}>
            <ArchiveIcon
              aria-hidden={false}
              aria-label={t('viewMenus.archived')}
              class="size-3.5 shrink-0 text-ink-extra-muted"
            />
          </Show>
          <Show when={agents() && details()}>
            {(details) => (
              <Show when={details().pullRequest}>
                {(pullRequest) => (
                  <AgentSessionPullRequestStatus
                    details={details()}
                    pullRequest={pullRequest()}
                    onOpenPullRequest={onOpenPullRequest()}
                  />
                )}
              </Show>
            )}
          </Show>
          <Show
            when={agents()}
            fallback={
              <Show when={props.unread || failed()}>
                <span
                  aria-label={props.unread ? 'Unread' : 'Last turn failed'}
                  class="size-1.5 shrink-0 rounded-full"
                  classList={{ 'bg-failure': failed(), 'bg-accent': !failed() }}
                />
              </Show>
            }
          >
            <AgentSessionStatusIndicator
              state={state()}
              unread={props.unread}
              failed={failed()}
            />
          </Show>
        </>
      }
    >
      <Show when={summary()}>
        {(summary) => (
          <span class="block min-w-0 truncate text-xs text-ink-extra-muted">
            <TextShimmer text={summary()} active />
          </span>
        )}
      </Show>
      <Show when={!agents() && details()}>
        {(details) => (
          <AgentSessionCodeDetails
            details={details()}
            onOpenPullRequest={onOpenPullRequest()}
          />
        )}
      </Show>
    </AgentSessionRow>
  );
}
