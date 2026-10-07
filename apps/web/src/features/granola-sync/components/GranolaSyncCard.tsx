import { Button } from '@ui';
import { For, Show } from 'solid-js';
import type {
  GranolaScope,
  GranolaSyncStatus,
  ImportedMeeting,
  ImportedMeetingRecord,
} from '../core/types';

export function GranolaSyncCard(props: {
  status: GranolaSyncStatus | undefined;
  meetings: ImportedMeeting[];
  record: ImportedMeetingRecord | undefined;
  pending: boolean;
  error: string | undefined;
  scope: GranolaScope;
  onScope: (scope: GranolaScope) => void;
  onStart: () => void;
  onStop: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <section
      aria-label="Granola meeting sync"
      class="rounded-lg border border-edge-muted p-4 flex flex-col gap-3"
    >
      <h3 class="font-medium">Granola meetings</h3>
      <p class="text-sm text-ink-muted">
        Save new meetings and future updates as private calls in Macro,
        including attendees, summaries, and available transcripts. Earlier
        meetings are not backfilled. Requires a Granola Business or Enterprise
        API key connected through Pipedream.
      </p>
      <Show
        when={props.status}
        fallback={<p class="text-sm text-ink-muted">Loading sync status…</p>}
      >
        <Show
          when={props.status?.enabled}
          fallback={
            <>
              <label class="flex flex-col gap-1 text-sm">
                Meeting access
                <select
                  class="bg-input border border-edge-muted rounded p-2"
                  value={props.scope}
                  onChange={(event) => {
                    const scope = event.currentTarget.value;
                    if (
                      scope === 'personal' ||
                      scope === 'public' ||
                      scope === 'all' ||
                      scope === 'workspace'
                    )
                      props.onScope(scope);
                  }}
                >
                  <option value="personal">
                    Personal and privately shared
                  </option>
                  <option value="public">Workspace-visible meetings</option>
                  <option value="all">Personal and workspace-visible</option>
                  <option value="workspace">
                    Workspace (workspace API key)
                  </option>
                </select>
              </label>
              <Button
                disabled={props.pending || !props.status?.connected}
                onClick={props.onStart}
              >
                Start meeting sync
              </Button>
              <Show when={!props.status?.connected}>
                <p class="text-sm text-ink-muted">
                  Enable your Granola connection to start syncing.
                </p>
              </Show>
            </>
          }
        >
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm">Meeting sync is on</span>
            <Button
              variant="outline"
              disabled={props.pending}
              onClick={props.onStop}
            >
              Stop sync
            </Button>
          </div>
        </Show>
        <Show when={props.status?.lastSyncedAt}>
          {(time) => (
            <p class="text-sm text-ink-muted">
              Last synced {new Date(time()).toLocaleString()}
            </p>
          )}
        </Show>
        <Show when={props.status?.lastError}>
          {(error) => <p class="text-sm text-ink-muted">{error()}</p>}
        </Show>
      </Show>
      <Show when={props.error}>
        {(error) => (
          <p role="alert" class="text-sm">
            {error()}
          </p>
        )}
      </Show>
      <p class="text-xs text-ink-muted">
        Stopping sync keeps saved calls. Deleting a meeting in Granola does not
        delete its copy in Macro.
      </p>
      <Show when={props.meetings.length > 0}>
        <h4 class="text-sm font-medium">Recent synced meetings</h4>
        <ul class="flex flex-col gap-1">
          <For each={props.meetings}>
            {(meeting) => (
              <li>
                <button
                  type="button"
                  class="text-left w-full rounded p-2 hover:bg-ink/4 focus-visible:bg-ink/6"
                  onClick={() => props.onSelect(meeting.id)}
                >
                  <span class="ph-no-capture">
                    {meeting.title ?? 'Untitled meeting'}
                  </span>
                  <Show when={meeting.startedAt}>
                    {(time) => (
                      <span class="ml-2 text-xs text-ink-muted">
                        {new Date(time()).toLocaleDateString()}
                      </span>
                    )}
                  </Show>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={props.record}>
        {(record) => <MeetingDetail record={record()} />}
      </Show>
    </section>
  );
}

function MeetingDetail(props: { record: ImportedMeetingRecord }) {
  const source = () =>
    props.record.sources.find((source) => source.provider === 'granola');
  const summary = () => {
    const value = source()?.metadata.summary;
    return typeof value === 'string' ? value : undefined;
  };
  const sourceUrl = () => {
    try {
      const url = new URL(source()?.externalUrl ?? '');
      return url.protocol === 'https:' ? url.href : undefined;
    } catch {
      return undefined;
    }
  };
  return (
    <article class="ph-no-capture border-t border-edge-muted pt-3 flex flex-col gap-3">
      <h4 class="font-medium">
        {props.record.entity.title ?? 'Untitled meeting'}
      </h4>
      <Show when={sourceUrl()}>
        {(url) => (
          <a
            href={url()}
            target="_blank"
            rel="noopener noreferrer"
            class="underline text-sm"
          >
            Open in Granola
          </a>
        )}
      </Show>
      <Show when={props.record.participants.length > 0}>
        <p class="text-sm text-ink-muted">
          {props.record.participants
            .map((p) => p.displayName ?? p.email ?? 'Participant')
            .join(', ')}
        </p>
      </Show>
      <Show when={summary()}>
        {(text) => <p class="whitespace-pre-wrap text-sm">{text()}</p>}
      </Show>
      <For each={props.record.transcripts}>
        {(transcript) => (
          <details>
            <summary class="text-sm">Transcript</summary>
            <div class="mt-2 max-h-96 overflow-y-auto flex flex-col gap-2">
              <For each={transcript.segments}>
                {(segment) => (
                  <p class="text-sm whitespace-pre-wrap">
                    <Show when={segment.speakerLabel}>
                      {(speaker) => <strong>{speaker()}: </strong>}
                    </Show>
                    {segment.content}
                  </p>
                )}
              </For>
            </div>
          </details>
        )}
      </For>
    </article>
  );
}
