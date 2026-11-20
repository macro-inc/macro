import {
  parseGithubPrUrl,
  toGithubKey,
} from '@app/features/block-pr/util/prKey';
import { t } from '@app/lib/i18n';
import { HoverCard } from '@core/component/HoverCard';
import {
  PullRequestPreviewCard,
  UnsyncedPullRequestPreviewCard,
} from '@core/component/LexicalMarkdown/component/decorator/PullRequestMention';
import { usePullRequestByGithubKeyQuery } from '@queries/storage/pr-mention';
import { createSignal, Show } from 'solid-js';
import { BranchPreview } from '../../../components/branch-preview/branch-preview';
import { SessionCodeIcon } from '../../../components/session-code-icon/session-code-icon';
import type { ConversationActions } from '../../../context/conversation-actions';
import type { SessionCodeDetails } from '../../../core/session-code-details';

export function ConversationCodeLink(props: {
  details: SessionCodeDetails;
  actions: ConversationActions;
  onPreviewChange?: (open: boolean) => void;
  onOpenRow?: (event: MouseEvent) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const githubKey = () => {
    const pr = props.details.pullRequest;
    if (!pr || pr.id) return undefined;
    const parsed = parseGithubPrUrl(pr.url);
    return parsed ? toGithubKey(parsed) : undefined;
  };
  // Resolve URL-only PRs only during an actual preview, never once per list row.
  const query = usePullRequestByGithubKeyQuery(githubKey, open);
  const prId = () =>
    props.details.pullRequest?.id ??
    (query.isSuccess ? query.data?.id : undefined);
  const branchUrl = () => {
    const { repository, branch } = props.details;
    if (!repository || !branch) return undefined;
    return `https://github.com/${repository}/tree/${encodeURIComponent(branch)}`;
  };
  const changeOpen = (value: boolean) => {
    setOpen(value);
    props.onPreviewChange?.(value);
  };

  return (
    <HoverCard
      placement="right-start"
      isolateClicks
      open={open()}
      triggerAs={props.details.pullRequest ? 'span' : 'button'}
      triggerAriaLabel={
        props.details.pullRequest ? undefined : t('agentWork.branchDetails')
      }
      triggerTabIndex={props.details.pullRequest ? undefined : 0}
      triggerOnKeyDown={(event) => {
        if (event.key !== 'ArrowDown') return;
        event.preventDefault();
        changeOpen(true);
      }}
      onOpenChange={changeOpen}
      triggerOnClick={(event) => {
        if (!props.details.pullRequest) props.onOpenRow?.(event);
      }}
      triggerClass="flex size-4 shrink-0 items-center justify-center"
      trigger={
        <Show
          when={props.details.pullRequest}
          fallback={<SessionCodeIcon details={props.details} />}
        >
          {(pr) => (
            <a
              href={pr().url}
              aria-label={t('agentWork.openPullRequest', {
                number: pr().number,
              })}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                props.actions.openPullRequest({ ...pr(), id: prId() }, event);
              }}
            >
              <SessionCodeIcon details={props.details} />
            </a>
          )}
        </Show>
      }
      content={
        <Show
          when={props.details.pullRequest}
          fallback={
            <BranchPreview
              branch={props.details.branch ?? ''}
              repository={props.details.repository}
              url={branchUrl()}
              onCopy={() =>
                props.actions.copyBranch(props.details.branch ?? '')
              }
              onOpen={() => {
                const url = branchUrl();
                if (url) props.actions.openBranch(url);
              }}
            />
          }
        >
          {(pr) => (
            <Show
              when={prId()}
              fallback={
                <UnsyncedPullRequestPreviewCard
                  label={
                    props.details.repository
                      ? `${props.details.repository}#${pr().number}`
                      : `#${pr().number}`
                  }
                  url={pr().url}
                />
              }
            >
              {(id) => <PullRequestPreviewCard id={id()} />}
            </Show>
          )}
        </Show>
      }
    />
  );
}
