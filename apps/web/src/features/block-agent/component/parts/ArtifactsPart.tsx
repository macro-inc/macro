/**
 * Files the agent produced outside the conversation — a walkthrough's
 * screenshots and recordings — as one media strip at the foot of its turn.
 *
 * The Agent Service collects these after the turn ends, so they are always a
 * finished set: there is no in-flight state to show, only what was made. A
 * file this browser cannot play or display still gets a row, because a
 * walkthrough that silently lost one of its pieces reads as a walkthrough
 * that never made it.
 */

import type {
  ArtifactItem,
  MessagePart,
} from '@service-agent-fold/generated/types';
import { For, type JSX, Match, Switch } from 'solid-js';

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** A size a person reads at a glance, not an exact byte count. */
function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    SIZE_UNITS.length - 1
  );
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 || value >= 10 ? 0 : 1)} ${SIZE_UNITS[exponent]}`;
}

function Artifact(props: { item: ArtifactItem }): JSX.Element {
  return (
    <Switch
      fallback={
        <a
          class="flex min-w-0 items-center gap-2 rounded-lg bg-surface px-3 py-2 text-xs leading-5 text-ink-extra-muted hover:bg-hover"
          href={props.item.uri}
          target="_blank"
          rel="noreferrer"
        >
          <span class="min-w-0 truncate text-ink">{props.item.name}</span>
          <span aria-hidden="true">·</span>
          <span class="shrink-0">{formatSize(props.item.sizeBytes)}</span>
        </a>
      }
    >
      <Match when={props.item.mimeType.startsWith('image/')}>
        <a href={props.item.uri} target="_blank" rel="noreferrer">
          <img
            class="max-h-64 w-auto rounded-lg bg-surface"
            src={props.item.uri}
            alt={props.item.name}
          />
        </a>
      </Match>
      <Match when={props.item.mimeType.startsWith('video/')}>
        {/* A screen recording carries no caption track to offer. */}
        <video
          class="max-h-64 w-auto rounded-lg bg-surface"
          src={props.item.uri}
          controls
          preload="metadata"
          playsinline
        />
      </Match>
    </Switch>
  );
}

export function ArtifactsPart(props: {
  part: Extract<MessagePart, { kind: 'artifacts' }>;
}): JSX.Element {
  return (
    <div class="flex flex-wrap items-start gap-2">
      <For each={props.part.items}>{(item) => <Artifact item={item} />}</For>
    </div>
  );
}
