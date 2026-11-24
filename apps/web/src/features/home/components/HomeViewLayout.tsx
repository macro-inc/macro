import { ViewShell } from '@app/components/view-shell';
import { type JSX, Show } from 'solid-js';

/** Notifications docks its feed beside details at the shared workspace breakpoint. */
export function HomeViewLayout(props: {
  inlinePreview: boolean;
  list: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <ViewShell.Root
      asidePreferenceKey="home"
      aside={props.inlinePreview ? { preserveDuringResize: false } : false}
      main={{ preferredWidth: 640, min: 224 }}
      resizable
    >
      <Show when={props.inlinePreview}>
        <ViewShell.Aside class="flex flex-col bg-panel">
          {props.list}
        </ViewShell.Aside>
      </Show>
      {/* Inline previews float their top bars over the detail, which
          reserves them through the content inset. */}
      <ViewShell.Main
        class={props.inlinePreview ? 'overflow-hidden' : undefined}
      >
        <Show when={props.inlinePreview} fallback={props.list}>
          {props.children}
        </Show>
      </ViewShell.Main>
    </ViewShell.Root>
  );
}
