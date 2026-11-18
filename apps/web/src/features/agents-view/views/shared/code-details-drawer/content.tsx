import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import {
  PullRequestPreviewCard,
  UnsyncedPullRequestPreviewCard,
} from '@core/component/LexicalMarkdown/component/decorator/PullRequestMention';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { BranchPreview } from '../../../components/branch-preview/branch-preview';
import { useCodeDetails } from './context';

export function CodeDetailsContent() {
  const state = useCodeDetails();
  return (
    <MobileDrawer.Portal>
      <MobileDrawer.Overlay />
      <MobileDrawer.Content
        aria-label={
          state.details().pullRequest
            ? t('agentWork.pullRequestDetails')
            : t('agentWork.branchDetails')
        }
      >
        <MobileDrawer.Handle />
        <MobileDrawer.ScrollBody>
          <Show
            when={state.details().pullRequest}
            fallback={
              <BranchPreview
                branch={state.details().branch ?? ''}
                repository={state.details().repository}
                url={state.branchUrl()}
                onCopy={() =>
                  state.actions.copyBranch(state.details().branch ?? '')
                }
                onOpen={() => {
                  const url = state.branchUrl();
                  if (url) state.actions.openBranch(url);
                }}
              />
            }
          >
            {(pr) => (
              <div class="space-y-2 px-3 pb-4">
                <Show
                  when={state.pullRequestId()}
                  fallback={
                    <UnsyncedPullRequestPreviewCard
                      label={
                        state.details().repository
                          ? `${state.details().repository}#${pr().number}`
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
                    state.actions.openPullRequest(
                      { ...pr(), id: state.pullRequestId() },
                      event
                    )
                  }
                >
                  {t('agentWork.openPullRequest', { number: pr().number })}
                </Button>
              </div>
            )}
          </Show>
        </MobileDrawer.ScrollBody>
      </MobileDrawer.Content>
    </MobileDrawer.Portal>
  );
}
