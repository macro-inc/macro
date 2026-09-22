import { parseGithubPrUrl, prHtmlUrl } from '@app/features/block-pr/util/prKey';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import type { AgentSessionEntity } from '@entity';
import SparkleIcon from '@phosphor/sparkle.svg';
import FilledSparkleIcon from '@phosphor-icons/core/fill/sparkle-fill.svg?component-solid';
import { Show } from 'solid-js';
import { AgentSessionCodeDetails } from '../components/AgentSessionCodeDetails';
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

  return (
    <AgentSessionRow
      id={props.entity.id}
      title={props.entity.name || 'Untitled conversation'}
      kind={mode()}
      state={state()}
      active={props.active}
      unread={props.unread}
      onOpen={props.onOpen}
      timestamp={compactAge(conversationTimestamp(props.entity))}
      detailsLabel={[details()?.repository, details()?.branch]
        .filter(Boolean)
        .join(' · ')}
      leading={
        <Show
          when={props.surface === 'home'}
          fallback={
            <AgentSessionStatusIndicator
              state={state()}
              unread={props.unread}
            />
          }
        >
          <Show when={mode() === 'code'} fallback={<SparkleIcon />}>
            <FilledSparkleIcon />
          </Show>
        </Show>
      }
      trailing={
        <Show when={props.surface === 'home' && props.unread}>
          <span
            aria-label="Unread"
            class="size-1.5 shrink-0 rounded-full bg-accent"
          />
        </Show>
      }
    >
      <Show when={details()}>
        {(details) => (
          <AgentSessionCodeDetails
            details={details()}
            onOpenPullRequest={
              props.entity.pullRequestId
                ? (event) => {
                    const id = props.entity.pullRequestId;
                    if (!id) return;
                    openWithSplit(
                      { type: 'pr', id },
                      {
                        preferNewSplit: openInNewSplitForMention(
                          event.shiftKey,
                          true
                        ),
                      }
                    );
                  }
                : undefined
            }
          />
        )}
      </Show>
    </AgentSessionRow>
  );
}
