import { onMount } from 'solid-js';
import diffHtml from '../assets/deploy-retry-diff.html?raw';

/** Trusted, build-time fixture output; no live HTML, highlighting, or workers. */
export default function DemoDeployDiff() {
  let host!: HTMLDivElement;
  onMount(() => {
    host.attachShadow({ mode: 'open' }).innerHTML = diffHtml;
  });
  return (
    <div class="flex flex-col gap-1">
      <span class="truncate font-mono text-xs text-ink-extra-muted">
        deploy/retry.ts
      </span>
      <div
        ref={host}
        aria-label="Changes to deploy/retry.ts"
        class="overflow-hidden rounded border border-edge-muted"
        style={{
          '--diffs-font-family': 'var(--font-mono)',
          '--diffs-font-size': '0.75rem',
          '--diffs-line-height': '18px',
          '--diffs-tab-size': '2',
          '--diffs-gap-block': '0',
          '--diffs-min-number-column-width': '4ch',
        }}
      />
    </div>
  );
}
