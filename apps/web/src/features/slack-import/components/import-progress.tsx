import { formatDate } from '@core/util/date';
import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import { For, Index, type JSX, Show } from 'solid-js';
import type {
  ImportConversation,
  ImportJob,
  ImportUploadProgress,
} from '../context/contracts';
import {
  ConversationKindIcon,
  conversationTone,
  DialogSectionTitle,
  formatBytes,
  humanize,
  jobTone,
  StatusBadge,
  type StatusDisplay,
} from './import-ui';

type Props = {
  job?: ImportJob;
  /** The local session's status, shown until the server receipt exists. */
  phase?: StatusDisplay;
  /** Only while a local session has started preparing or uploading parts. */
  upload?: ImportUploadProgress;
  /** Undefined unless the host can confirm current access. */
  channelHref(id: string): string | undefined;
};

const TERMINAL_JOB = new Set<ImportJob['status']>([
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
]);

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
  const counters = () => conversation().counters;
  const skippedWithoutReason = () =>
    conversation().status === 'skipped' &&
    !conversation().warnings.length &&
    !conversation().error;
  return (
    <li class="flex min-w-0 flex-col gap-1 px-4 py-3">
      <div class="flex items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-2">
          <ConversationKindIcon kind={conversation().kind} />
          <h4 class="truncate text-sm font-medium text-ink">
            {conversation().name || conversation().slackChannelId}
          </h4>
          <Show when={conversation().archived}>
            <span class="shrink-0 text-xs text-ink-extra-muted">Archived</span>
          </Show>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <Show when={href()}>
            {(href) => (
              <a
                href={href()}
                class="inline-flex items-center gap-1 text-xs font-medium text-link outline-none hover:text-link-hover hover:underline focus-visible:underline"
              >
                Open channel
                <ArrowUpRightIcon aria-hidden="true" class="size-3" />
              </a>
            )}
          </Show>
          <StatusBadge
            tone={conversationTone(conversation().status)}
            label={humanize(conversation().status)}
          />
        </div>
      </div>
      <p class="text-xs text-ink-muted">
        {conversation().verifiedParts} / {conversation().partCount ?? '?'} parts
        verified · {counters().processed} processed · {counters().imported}{' '}
        imported · {counters().duplicates} duplicates · {counters().skipped}{' '}
        skipped · {counters().reactions} reactions
      </p>
      <Show when={conversation().searchStatus !== 'not_needed'}>
        <p class="text-xs text-ink-extra-muted">
          Search indexing: {humanize(conversation().searchStatus)}
        </p>
      </Show>
      <Show when={conversation().error}>
        {(error) => (
          <p role="alert" class="text-xs text-failure-ink">
            {humanize(error())}
          </p>
        )}
      </Show>
      <For each={conversation().warnings}>
        {(warning) => (
          <p class="text-xs text-warning-ink">{humanize(warning)}</p>
        )}
      </For>
      <Show when={skippedWithoutReason()}>
        <p class="text-xs text-ink-muted">
          Skipped by the server without a reason.
        </p>
      </Show>
    </li>
  );
}

function UploadProgress(props: { upload: ImportUploadProgress }): JSX.Element {
  const percent = () =>
    props.upload.total > 0
      ? Math.min(
          100,
          Math.round((props.upload.loaded / props.upload.total) * 100)
        )
      : 0;
  return (
    <div class="flex flex-col gap-1.5">
      <div class="flex items-center justify-between gap-3 text-xs text-ink-muted">
        <label for="slack-upload-progress">
          Upload: {formatBytes(props.upload.loaded)} of{' '}
          {formatBytes(props.upload.total)} prepared
        </label>
        <Show when={!props.upload.indeterminate}>
          <span class="tabular-nums">{percent()}%</span>
        </Show>
      </div>
      <progress
        id="slack-upload-progress"
        class="h-1.5 w-full appearance-none overflow-hidden rounded-full bg-edge-muted text-accent [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-accent [&::-webkit-progress-bar]:bg-transparent [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-accent [&::-webkit-progress-value]:transition-[width]"
        max={Math.max(1, props.upload.total)}
        value={props.upload.indeterminate ? undefined : props.upload.loaded}
      />
      <p class="text-xs text-ink-extra-muted">
        The total grows as history is read. Files and attachments are never
        uploaded.
      </p>
    </div>
  );
}

export function ImportProgress(props: Props): JSX.Element {
  const status = () => props.job?.status;
  const badge = (): StatusDisplay => {
    const current = status();
    if (current) return { tone: jobTone(current), label: humanize(current) };
    return props.phase ?? { tone: 'neutral', label: 'Idle' };
  };
  const source = () =>
    props.job?.source.kind === 'known'
      ? props.job.source.sourceId
      : 'Confirmed unknown workspace';
  const cancelled = () => status() === 'cancelling' || status() === 'cancelled';
  const active = () => {
    const current = status();
    return current !== undefined && !TERMINAL_JOB.has(current);
  };
  return (
    <section class="flex flex-col gap-3" aria-label="Import progress">
      <div class="flex items-center justify-between gap-3">
        <DialogSectionTitle>Progress</DialogSectionTitle>
        <StatusBadge role="status" tone={badge().tone} label={badge().label} />
      </div>
      <Show when={props.upload}>
        {(upload) => <UploadProgress upload={upload()} />}
      </Show>
      <Show when={props.job}>
        {(job) => (
          <>
            <p class="text-xs text-ink-muted">
              {job().conversations.length} selected ·{' '}
              {job().includeMessageHistory
                ? 'With message history'
                : 'Without message history'}{' '}
              · {source()}
              <Show when={job().createdAt}>
                {(createdAt) => (
                  <>
                    {' '}
                    · Started{' '}
                    <time dateTime={createdAt()}>
                      {formatDate(createdAt(), { showTime: true })}
                    </time>
                  </>
                )}
              </Show>
            </p>
            <Show when={cancelled()}>
              <p class="text-xs text-warning-ink">
                Cancellation is not rollback. Committed messages and channels
                remain; running conversations may finish before cancellation
                settles.
              </p>
            </Show>
            <ul class="divide-y divide-edge-divider overflow-hidden rounded-lg border border-edge-muted">
              <Index each={job().conversations}>
                {(conversation) => (
                  <ConversationProgress
                    conversation={conversation()}
                    channelHref={props.channelHref}
                  />
                )}
              </Index>
            </ul>
            <Show when={active()}>
              <p class="text-xs text-ink-extra-muted">
                Cancelling stops future work only. Running conversations may
                finish, and imported channels and messages are kept.
              </p>
            </Show>
          </>
        )}
      </Show>
    </section>
  );
}
