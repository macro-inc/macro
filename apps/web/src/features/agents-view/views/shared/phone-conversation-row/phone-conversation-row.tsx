import {
  parseGithubPrUrl,
  toGithubKey,
} from '@app/features/block-pr/util/prKey';
import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import {
  PullRequestPreviewCard,
  UnsyncedPullRequestPreviewCard,
} from '@core/component/LexicalMarkdown/component/decorator/PullRequestMention';
import { unreadFilterFn } from '@entity/utils/filter';
import ArchiveIcon from '@icon/system/regular/archive.svg';
import { usePullRequestByGithubKeyQuery } from '@queries/storage/pr-mention';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { BranchPreview } from '../../../components/branch-preview/branch-preview';
import { SessionCodeIcon } from '../../../components/session-code-icon/session-code-icon';
import { SessionStatusGlyph } from '../../../components/session-status-glyph/session-status-glyph';
import type { ConversationActions } from '../../../context/conversation-actions';
import { conversationState } from '../../../core/conversation-state';
import type { AgentsMode } from '../../../core/mode';
import type { AgentConversationEntity } from '../../../core/recent-conversations';
import { sessionRowStatus } from '../../../core/session-status';
import { conversationCodeDetails } from '../../../queries/conversation-code-details';

export function PhoneConversationRow(props: {
  conversation: AgentConversationEntity;
  archived?: boolean;
  mode: AgentsMode;
  waiting?: boolean;
  actions: ConversationActions;
  onOpen: (event: MouseEvent) => void;
}) {
  const code = () =>
    props.conversation.type === 'agent_session' && props.mode === 'code'
      ? conversationCodeDetails(props.conversation)
      : undefined;
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  const githubKey = () => {
    const pr = code()?.pullRequest;
    if (!pr || pr.id) return undefined;
    const parsed = parseGithubPrUrl(pr.url);
    return parsed ? toGithubKey(parsed) : undefined;
  };
  const query = usePullRequestByGithubKeyQuery(githubKey, detailsOpen);
  const prId = () =>
    code()?.pullRequest?.id ?? (query.isSuccess ? query.data?.id : undefined);
  const state = () =>
    props.conversation.type === 'agent_session'
      ? conversationState(
          props.conversation.status,
          props.conversation.turnState
        )
      : 'dormant';
  const status = () =>
    sessionRowStatus(
      state(),
      props.conversation.type === 'agent_session' &&
        props.conversation.turnState === 'failed',
      unreadFilterFn(props.conversation),
      !!props.waiting
    );
  return (
    <div class="flex h-[46px] min-w-0 items-center gap-2 px-3 text-ink">
      <Button
        variant="ghost"
        class="flex h-full min-w-0 flex-1 items-center gap-2 p-0 text-left font-normal"
        onClick={props.onOpen}
      >
        <span class="flex size-5 shrink-0 items-center justify-center">
          <Show
            when={props.archived}
            fallback={<SessionStatusGlyph state={status()} />}
          >
            <ArchiveIcon class="size-3.5 text-ink-muted" />
          </Show>
        </span>
        <span class="min-w-0 flex-1 truncate text-base font-normal">
          {props.conversation.name ||
            (props.conversation.type === 'agent_session'
              ? t('agentWork.untitledConversation')
              : t('agentWork.untitledChat'))}
        </span>
      </Button>
      <Show when={code()}>
        {(details) => (
          <Show
            when={details().pullRequest || details().branch}
            fallback={<span class="w-11 shrink-0" />}
          >
            <MobileDrawer
              side="bottom"
              open={detailsOpen()}
              onOpenChange={setDetailsOpen}
            >
              <MobileDrawer.Trigger
                as={Button}
                variant="ghost"
                size="icon-md"
                class="size-11 shrink-0"
                aria-label={t('agentWork.branchDetails')}
                onClick={(event: MouseEvent) => event.stopPropagation()}
              >
                <SessionCodeIcon details={details()} />
              </MobileDrawer.Trigger>
              <MobileDrawer.Portal>
                <MobileDrawer.Overlay />
                <MobileDrawer.Content aria-label={t('agentWork.branchDetails')}>
                  <MobileDrawer.Handle />
                  <MobileDrawer.ScrollBody>
                    <Show
                      when={details().pullRequest}
                      fallback={
                        <BranchPreview
                          url={
                            details().repository && details().branch
                              ? `https://github.com/${details().repository}/tree/${encodeURIComponent(details().branch!)}`
                              : undefined
                          }
                          branch={details().branch ?? ''}
                          repository={details().repository}
                          onCopy={() =>
                            props.actions.copyBranch(details().branch ?? '')
                          }
                          onOpen={() => {
                            const { repository, branch } = details();
                            if (repository && branch)
                              props.actions.openBranch(
                                `https://github.com/${repository}/tree/${encodeURIComponent(branch)}`
                              );
                          }}
                        />
                      }
                    >
                      {(pr) => (
                        <div class="space-y-2 px-3 pb-4">
                          <Show
                            when={prId()}
                            fallback={
                              <UnsyncedPullRequestPreviewCard
                                label={
                                  details().repository
                                    ? `${details().repository}#${pr().number}`
                                    : `#${pr().number}`
                                }
                                url={pr().url}
                              />
                            }
                          >
                            {(id) => <PullRequestPreviewCard id={id()} />}
                          </Show>
                          <Button
                            variant="ghost"
                            onClick={(event) =>
                              props.actions.openPullRequest(
                                { ...pr(), id: prId() },
                                event
                              )
                            }
                          >
                            {t('agentWork.openPullRequest', {
                              number: pr().number,
                            })}
                          </Button>
                        </div>
                      )}
                    </Show>
                  </MobileDrawer.ScrollBody>
                </MobileDrawer.Content>
              </MobileDrawer.Portal>
            </MobileDrawer>
          </Show>
        )}
      </Show>
      <Show when={!code()}>
        <span class="w-11 shrink-0" />
      </Show>
    </div>
  );
}
