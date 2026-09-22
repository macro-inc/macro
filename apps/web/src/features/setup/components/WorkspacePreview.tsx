import LogoIcon from '@icon/macro-logo.svg';
import { For } from 'solid-js';

export function WorkspacePreview(props: { name?: string }) {
  return (
    <div
      aria-label="Workspace preview"
      class="overflow-hidden rounded-2xl border border-ink/15 bg-[color-mix(in_srgb,var(--color-surface),var(--color-ink)_4%)] text-ink shadow-md"
      style={{
        '--color-surface': 'var(--theme-surface, var(--layer-surface))',
        '--color-ink': 'var(--color-content-0)',
        '--color-ink-muted': 'var(--color-content-1)',
        '--color-edge-muted': 'var(--color-surface-3)',
      }}
    >
      <div class="flex h-8 items-center gap-1.5 border-b border-edge-muted px-3">
        <For each={[1, 2, 3]}>
          {() => <span class="size-1.5 rounded-full bg-ink/20" />}
        </For>
        <span class="mx-auto text-[9px] text-ink-muted">
          {props.name || 'Your workspace'}
        </span>
      </div>
      <div class="flex h-52 text-[10px]">
        <div class="flex w-28 shrink-0 flex-col gap-3 border-r border-edge-muted bg-ink/[0.03] p-4">
          <LogoIcon class="mb-2 size-5" />
          <For each={['Home', 'Inbox', 'Documents', 'Tasks', 'Channels']}>
            {(label) => <span class="text-ink-muted">{label}</span>}
          </For>
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-3 p-5">
          <p class="text-sm font-medium">A little more in sync.</p>
          <p class="text-ink-muted">Everything you need. Right here.</p>
          <For
            each={[
              'A conversation worth continuing',
              'The next big idea',
              'A clearer path forward',
            ]}
          >
            {(text) => (
              <div class="flex items-center gap-2 rounded-lg border border-edge-muted p-2.5">
                <span class="size-3 rounded-sm border border-ink/20" />
                <span class="truncate text-ink-muted">{text}</span>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
