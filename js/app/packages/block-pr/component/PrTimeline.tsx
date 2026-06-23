import type { InputSnapshot } from '@channel/Input/types';
import type { DiscussionSource } from '@core/comments/discussion';
import {
  DiscussionInput,
  DiscussionProvider,
  DiscussionThreadView,
} from '@core/comments/discussion';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { ENABLE_PR_DISCUSSION_INPUT } from '@core/constant/featureFlags';
import CaretDown from '@phosphor/caret-down.svg';
import CaretRight from '@phosphor/caret-right.svg';
import type { GithubPullRequestComment } from '@service-storage/generated/schemas';
import { ToggleSwitch } from '@ui';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';

import { buildTimeline } from '../data/timeline';
import { isGithubBotLogin } from '../util/githubMarkdown';
import { GithubMessageView } from './GithubMessageView';

/**
 * Unified PR discussion section, styled like the task block's: a collapsible
 * "Discussion" divider over read-only GitHub comments interleaved by
 * timestamp with editable Macro discussion threads, plus a composer.
 */
export function PrTimeline(props: {
  githubItems: GithubPullRequestComment[];
  source: DiscussionSource;
}) {
  const [isExpanded, setIsExpanded] = createSignal(true);
  const [hideBots, setHideBots] = createSignal(false);

  const visibleGithubItems = createMemo(() =>
    hideBots()
      ? props.githubItems.filter((item) => !isGithubBotLogin(item.authorLogin))
      : props.githubItems
  );
  const botCount = createMemo(
    () =>
      props.githubItems.filter((item) => isGithubBotLogin(item.authorLogin))
        .length
  );

  const entries = createMemo(() =>
    buildTimeline(visibleGithubItems(), props.source.threads())
  );

  let composerHandle: { clear: () => void } | undefined;

  const handleCreateThread = async (snapshot: InputSnapshot) => {
    const text = snapshot.value.trim();
    if (!text) return;
    await props.source.createThread(text, snapshot.mentions);
    composerHandle?.clear();
  };

  return (
    <section class="mt-8 pb-12">
      <div class="flex items-center gap-2 pt-2">
        <div class="w-6 border-t border-edge-muted" />
        <button
          type="button"
          class="flex items-center gap-1 px-2 hover:opacity-70 transition-opacity"
          onClick={() => setIsExpanded(!isExpanded())}
        >
          {isExpanded() ? (
            <CaretDown class="size-3" />
          ) : (
            <CaretRight class="size-3" />
          )}
          <span class="text-xs">Discussion</span>
        </button>
        <div class="flex-1 border-t border-edge-muted" />
        <Show when={botCount() > 0}>
          <ToggleSwitch
            class="shrink-0"
            checked={hideBots()}
            onChange={setHideBots}
            label={`Hide bots (${botCount()})`}
            labelClass="text-xs text-ink-muted"
          />
        </Show>
      </div>

      <Show when={isExpanded()}>
        <DiscussionProvider source={props.source}>
          <StaticMarkdownContext>
            <div class="py-2 flex flex-col text-xs">
              <For each={entries()}>
                {(entry) => (
                  <Switch>
                    <Match when={entry.kind === 'github-comment' && entry}>
                      {(commentEntry) => (
                        <GithubMessageView comment={commentEntry().item} />
                      )}
                    </Match>
                    <Match when={entry.kind === 'macro-thread' && entry}>
                      {(threadEntry) => (
                        <DiscussionThreadView thread={threadEntry().thread} />
                      )}
                    </Match>
                  </Switch>
                )}
              </For>

              <Show when={ENABLE_PR_DISCUSSION_INPUT && props.source.canEdit()}>
                <div class="pt-2">
                  <DiscussionInput
                    input={{
                      mode: 'channel',
                      placeholder: 'Leave a comment...',
                    }}
                    onSend={handleCreateThread}
                    onReady={(handle) => {
                      composerHandle = handle;
                    }}
                    autofocus={false}
                  />
                </div>
              </Show>
            </div>
          </StaticMarkdownContext>
        </DiscussionProvider>
      </Show>
    </section>
  );
}
