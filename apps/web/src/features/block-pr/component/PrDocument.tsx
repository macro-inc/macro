import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import type { GithubPullRequestWithDetails } from '@queries/storage/github-pull-requests';
import { type Accessor, createMemo, type JSX, Show } from 'solid-js';
import {
  cleanGithubMarkdown,
  githubAvatarUrl,
  githubDisplayLogin,
} from '../util/githubMarkdown';
import type { PrRef } from '../util/prKey';
import { prDisplayName } from '../util/prKey';
import { PrPill, PrStatusChip } from './PrStatus';

/** Display data supplied by the authenticated block or a local preview. */
export type PrDocumentData = Partial<
  Pick<
    GithubPullRequestWithDetails,
    | 'name'
    | 'status'
    | 'authorLogin'
    | 'description'
    | 'url'
    | 'additions'
    | 'deletions'
  >
>;

/** The PR block's content, independent of fetching and workspace chrome. */
export function PrDocument(props: {
  prRef: PrRef;
  pullRequest: PrDocumentData | undefined;
  children?: JSX.Element;
}) {
  const pullRequest = () => props.pullRequest;
  return (
    <>
      <PrTitle prRef={props.prRef} pullRequest={pullRequest} />
      <div class="spacer h-3" />
      <PrMetadata prRef={props.prRef} pullRequest={pullRequest} />
      <PrDescription pullRequest={pullRequest} />
      {props.children}
    </>
  );
}

function PrTitle(props: {
  prRef: PrRef;
  pullRequest: Accessor<PrDocumentData | undefined>;
}) {
  return (
    <h1 class="ph-no-capture text-2xl font-semibold">
      {props.pullRequest()?.name ?? prDisplayName(props.prRef)}
    </h1>
  );
}

function PrMetadata(props: {
  prRef: PrRef;
  pullRequest: Accessor<PrDocumentData | undefined>;
}) {
  const pullRequest = () => props.pullRequest();

  return (
    <div class="mb-6 flex flex-row flex-wrap items-center gap-2 text-sm empty:hidden">
      <Show when={pullRequest()?.status}>
        {(status) => <PrStatusChip status={status()} />}
      </Show>
      <Show when={pullRequest()?.authorLogin}>
        {(authorLogin) => (
          <PrPill
            href={`https://github.com/${githubDisplayLogin(authorLogin())}`}
            class="text-ink-muted"
          >
            <img
              src={githubAvatarUrl(authorLogin())}
              alt=""
              class="size-3.5 rounded-full shrink-0"
              loading="lazy"
            />
            <span class="truncate">{githubDisplayLogin(authorLogin())}</span>
          </PrPill>
        )}
      </Show>
      <PrPill href={pullRequest()?.url} class="text-ink-muted">
        {prDisplayName(props.prRef)}
      </PrPill>
      <Show
        when={
          pullRequest()?.additions != null || pullRequest()?.deletions != null
        }
      >
        <PrPill>
          <span class="text-success">+{pullRequest()?.additions ?? 0}</span>
          <span class="text-failure">−{pullRequest()?.deletions ?? 0}</span>
        </PrPill>
      </Show>
    </div>
  );
}

function PrDescription(props: {
  pullRequest: Accessor<PrDocumentData | undefined>;
}) {
  const description = createMemo(() => {
    const raw = props.pullRequest()?.description;
    if (!raw) return null;
    const cleaned = cleanGithubMarkdown(raw);
    return cleaned || null;
  });

  return (
    <Show when={description()}>
      {(markdown) => (
        <StaticMarkdownContext>
          <div class="ph-no-capture text-sm wrap-break-word max-w-full overflow-x-auto">
            <StaticMarkdown markdown={markdown()} target="internal" />
          </div>
        </StaticMarkdownContext>
      )}
    </Show>
  );
}
