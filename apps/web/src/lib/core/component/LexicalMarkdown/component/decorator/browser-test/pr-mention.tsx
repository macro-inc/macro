import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { onElementConnect } from '@core/util/onElementConnect';
import { PullRequestMentionNode } from '@macro-inc/lexical-core';
import { setDecorator } from '@macro-inc/lexical-core/decoratorRegistry';
import { pullRequestMentionKeys } from '@queries/storage/keys';
import type { ForeignEntity } from '@service-storage/generated/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, For, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '../../../context/LexicalWrapperContext';
import { selectionDataPlugin } from '../../../plugins';
import { channelTheme } from '../../../theme';
import { setEditorStateFromMarkdown } from '../../../utils';
import { DecoratorRenderer } from '../../core/DecoratorRenderer';
import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '../../core/StaticMarkdown';
import { PullRequestMention } from '../PullRequestMention';

setDecorator(PullRequestMentionNode, PullRequestMention);

const title = 'feat(text-paste): smart paste for GitHub pull request URLs';
const url = 'https://github.com/macro-inc/macro/pull/7956';
const githubKey = 'macro-inc/macro/pull/7956';
const pullRequest: ForeignEntity = {
  id: 'pr-mention-fixture',
  foreignEntityId: githubKey,
  foreignEntitySource: 'github_pull_request',
  metadata: {
    name: title,
    owner: 'macro-inc',
    repo: 'macro',
    number: 7956,
    url,
    status: 'merged',
  },
  createdAt: '',
  updatedAt: '',
  storedForAuthEntity: '',
  storedForId: '',
};

const mention = (data: Record<string, string>) =>
  `<m-pr-mention>${JSON.stringify(data)}</m-pr-mention>`;
// Sent from a Macro composer, which writes the resolved label to the node.
const composed = mention({
  id: pullRequest.id,
  label: `macro-inc/macro#7956 ${title}`,
});
// Written by an agent, which knows only the GitHub URL.
const agentWritten = mention({ url, label: '' });

/** Records every height a sent message takes, starting at mount. */
function SentMessage(props: { markdown: string }) {
  const [heights, setHeights] = createSignal<number[]>([]);
  const observer = new ResizeObserver(([entry]) => {
    const height = Math.round(entry.borderBoxSize[0].blockSize);
    setHeights((prev) => (prev.at(-1) === height ? prev : [...prev, height]));
  });
  onCleanup(() => observer.disconnect());
  return (
    <div class="space-y-1">
      <div
        ref={(element) => observer.observe(element)}
        data-testid="sent-message"
        class="w-96 border border-edge-muted p-2"
      >
        <StaticMarkdown markdown={props.markdown} target="internal" />
      </div>
      <div data-testid="height-history" class="text-xs text-ink-muted">
        {`Height since mount: ${heights()
          .map((height) => `${height}px`)
          .join(' → ')}`}
      </div>
    </div>
  );
}

/** An editable editor with only the PR mention decorator registered. */
function Composer(props: { markdown: string }) {
  const wrapper = createLexicalWrapper({
    type: 'chat',
    namespace: 'pr-mention-composer',
    isInteractable: () => true,
  });
  wrapper.plugins.richText().use(selectionDataPlugin(wrapper));
  setEditorStateFromMarkdown(wrapper.editor, props.markdown);
  onCleanup(() => wrapper.cleanup());
  return (
    <LexicalWrapperContext.Provider value={wrapper}>
      <div data-testid="composer" class="w-96 border border-edge-muted p-2">
        <div
          ref={(element) =>
            onElementConnect(element, () =>
              wrapper.editor.setRootElement(element)
            )
          }
          contentEditable
          role="textbox"
          class="outline-none"
        />
        <DecoratorRenderer editor={wrapper.editor} />
      </div>
    </LexicalWrapperContext.Provider>
  );
}

function Fixture() {
  const client = new QueryClient();
  const wrapper = createLexicalWrapper({
    type: 'chat',
    namespace: 'pr-mention-fixture',
    isInteractable: () => false,
  });
  onCleanup(() => {
    wrapper.cleanup();
    client.clear();
  });
  const resolve = () => {
    client.setQueryData(
      pullRequestMentionKeys.foreignEntity(pullRequest.id).queryKey,
      pullRequest
    );
    client.setQueryData(
      pullRequestMentionKeys.byGithubKey(githubKey).queryKey,
      pullRequest
    );
  };
  return (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <QueryClientProvider client={client}>
          <LexicalWrapperContext.Provider
            value={{ ...wrapper, skipPreviewFetch: true }}
          >
            <StaticMarkdownContext theme={channelTheme}>
              <main class="p-4 text-ink bg-page space-y-4">
                <For
                  each={[
                    composed,
                    `Just merged ${composed}, after next deploy we'll have nice mention nodes`,
                    agentWritten,
                    `Opened ${agentWritten} for the paste fix.`,
                  ]}
                >
                  {(markdown) => <SentMessage markdown={markdown} />}
                </For>
                <Composer
                  markdown={`Opened ${agentWritten} and ${composed} today`}
                />
                <button
                  type="button"
                  data-testid="resolve"
                  class="rounded-md border border-edge-muted px-2 py-1"
                  onClick={resolve}
                >
                  Resolve pull request
                </button>
              </main>
            </StaticMarkdownContext>
          </LexicalWrapperContext.Provider>
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
