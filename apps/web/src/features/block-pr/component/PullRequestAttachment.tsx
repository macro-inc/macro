import { PullRequestEntityLink } from '@core/component/LexicalMarkdown/component/decorator/PullRequestMention';
import EyeSlash from '@icon/system/regular/eye-slash.svg';
import LoadingSpinner from '@icon/system/regular/spinner.svg';
import { usePrMentionQuery } from '@queries/storage/pr-mention';
import { type JSX, Show } from 'solid-js';

function StatusPill(props: { children: JSX.Element }) {
  return (
    <span class="inline-flex h-6 items-center gap-2 rounded-md border border-edge-muted/50 px-2 text-sm text-ink opacity-50">
      {props.children}
    </span>
  );
}

/**
 * A shared pull request on a channel message. The mention face reads the
 * foreign-entity record; the generic attachment preview has no such read and
 * renders every one as "No Access".
 */
export function PullRequestAttachment(props: { id: string }) {
  const query = usePrMentionQuery(() => props.id);
  const entity = () => (query.isSuccess ? query.data : undefined);

  return (
    <Show
      when={entity()}
      fallback={
        <Show
          when={!query.isLoading}
          fallback={
            <StatusPill>
              <span class="size-3.5 animate-spin">
                <LoadingSpinner />
              </span>
              Loading...
            </StatusPill>
          }
        >
          <StatusPill>
            <EyeSlash class="size-3.5 text-ink-muted" />
            No Access
          </StatusPill>
        </Show>
      }
    >
      {(loaded) => (
        <PullRequestEntityLink
          entity={loaded()}
          class="h-6 rounded-md border border-edge-muted/50 px-2 text-sm"
        />
      )}
    </Show>
  );
}
