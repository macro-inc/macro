import { For, Index, type JSX, Show } from 'solid-js';
import type {
  ImportConversation,
  ImportJob,
  ImportUploadProgress,
} from '../context/contracts';

type Props = {
  job?: ImportJob;
  phase?: string;
  upload?: ImportUploadProgress;
  /** Undefined unless the host can confirm current access. */
  channelHref(id: string): string | undefined;
};

function label(value: string): string {
  return value.replaceAll('_', ' ');
}

function ConversationProgress(
  props: Pick<Props, 'channelHref'> & {
    conversation: ImportConversation;
  }
): JSX.Element {
  const conversation = () => props.conversation;
  const href = (): string | undefined => {
    const { status, channelId } = conversation();
    if (status === 'skipped' || !channelId) return undefined;
    return props.channelHref(channelId);
  };
  return (
    <article class="min-w-0 rounded border border-edge-muted p-3">
      <h4 class="break-words font-medium">
        {conversation().name || conversation().slackChannelId}
      </h4>
      <p class="text-xs text-ink-muted">
        {conversation().slackChannelId} · {label(conversation().kind)}
        {conversation().archived ? ' · Archived' : ''}
      </p>
      <p>
        {label(conversation().status)} · {conversation().verifiedParts} /{' '}
        {conversation().partCount ?? '?'} parts verified
      </p>
      <p class="text-ink-muted">
        {conversation().counters.processed} processed ·{' '}
        {conversation().counters.imported} imported ·{' '}
        {conversation().counters.duplicates} duplicates ·{' '}
        {conversation().counters.skipped} skipped ·{' '}
        {conversation().counters.reactions} reactions
      </p>
      <p class="text-xs text-ink-muted">
        Search: {label(conversation().searchStatus)}
      </p>
      <Show when={conversation().error}>
        {(error) => <p role="alert">Error: {label(error())}</p>}
      </Show>
      <For each={conversation().warnings}>
        {(warning) => <p class="text-xs text-ink-muted">{label(warning)}</p>}
      </For>
      <Show
        when={
          conversation().status === 'skipped' &&
          !conversation().warnings.length &&
          !conversation().error
        }
      >
        <p class="text-xs text-ink-muted">
          Skipped by the server; no additional reason provided.
        </p>
      </Show>
      <Show when={href()}>
        {(href) => (
          <a class="inline-block mt-2 underline" href={href()}>
            Open channel
          </a>
        )}
      </Show>
    </article>
  );
}

export function ImportProgress(props: Props): JSX.Element {
  return (
    <section class="flex flex-col gap-3 text-sm" aria-label="Import progress">
      <p role="status">{label(props.job?.status ?? props.phase ?? 'idle')}</p>
      <Show when={props.upload}>
        {(upload) => (
          <div class="flex flex-col gap-1">
            <label for="slack-upload-progress">
              Upload: {upload().loaded.toLocaleString()} /{' '}
              {upload().total.toLocaleString()} bytes prepared so far
            </label>
            <progress
              id="slack-upload-progress"
              class="w-full"
              max={Math.max(1, upload().total)}
              value={upload().indeterminate ? undefined : upload().loaded}
            />
            <p class="text-xs text-ink-muted">
              The total grows as history is read. File and attachment bytes are
              never uploaded.
            </p>
          </div>
        )}
      </Show>
      <Show when={props.job}>
        {(job) => (
          <>
            <p class="break-all text-xs text-ink-muted">
              Job {job().jobId} · {job().createdAt}
            </p>
            <p>
              {job().conversations.length} selected ·{' '}
              {job().includeMessageHistory
                ? 'With message history'
                : 'Without message history'}
            </p>
            <p class="text-xs text-ink-muted">
              Source:{' '}
              {props.job?.source.kind === 'known'
                ? props.job.source.sourceId
                : 'Confirmed unknown workspace'}
            </p>
            <Show
              when={
                job().status === 'cancelling' || job().status === 'cancelled'
              }
            >
              <p>
                Cancellation is not rollback. Committed messages and channels
                remain; running conversations may finish before cancellation
                settles.
              </p>
            </Show>
            <Index each={job().conversations}>
              {(conversation) => (
                <ConversationProgress
                  conversation={conversation()}
                  channelHref={props.channelHref}
                />
              )}
            </Index>
          </>
        )}
      </Show>
    </section>
  );
}
