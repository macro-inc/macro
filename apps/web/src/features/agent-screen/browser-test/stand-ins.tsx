import {
  createSignal,
  type JSX,
  onMount,
  type ParentProps,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';

/**
 * Portals into the fixture's own split header (`#split-header-*`), once the
 * fixture's markup is in the document.
 */
function toSlot(id: string, content: JSX.Element) {
  const [mount, setMount] = createSignal<HTMLElement>();
  onMount(() => setMount(document.getElementById(id) ?? undefined));
  return (
    <Show when={mount()}>
      {(element) => (
        <Portal
          mount={element()}
          ref={(div) => (div.style.display = 'contents')}
        >
          {content}
        </Portal>
      )}
    </Show>
  );
}

export function SplitHeaderLeft(props: ParentProps) {
  return toSlot('split-header-left', props.children);
}

export function SplitHeaderRight(props: ParentProps) {
  return toSlot('split-header-right', props.children);
}

function MobileHeaderRoot(props: ParentProps<{ trailing?: JSX.Element }>) {
  return (
    <>
      {toSlot('split-header-left', props.children)}
      {toSlot('split-header-right', props.trailing)}
    </>
  );
}

/** The header's floating pill, as the real island draws it. */
function Island(props: ParentProps<{ class?: string }>) {
  return (
    <div class="island flex h-10 min-w-0 shrink-0 items-center gap-1 rounded-full px-3">
      {props.children}
    </div>
  );
}

export const MobileHeader = Object.assign(MobileHeaderRoot, {
  Island,
  Title: (props: { label: string }) => (
    <Island>
      <span class="truncate text-sm font-semibold text-ink">{props.label}</span>
    </Island>
  ),
});
