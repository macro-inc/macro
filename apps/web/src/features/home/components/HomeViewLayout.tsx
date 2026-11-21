import { type AsideLayout, ViewShell } from '@app/components/view-shell';
import { type JSX, Show } from 'solid-js';

/** Notifications docks its feed beside details at the shared workspace breakpoint. */
/** Where a Home's list keeps its width, and the bounds it keeps it in. */
export type HomeListWidth = {
  asidePreferenceKey: string;
  aside: Partial<AsideLayout>;
};

export function HomeViewLayout(props: {
  inlinePreview: boolean;
  /** New Home's list, which both its tabs share; old Home's by default. */
  listLayout?: HomeListWidth;
  list: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <ViewShell.Root
      asidePreferenceKey={props.listLayout?.asidePreferenceKey ?? 'home'}
      aside={
        props.inlinePreview
          ? (props.listLayout?.aside ?? { preserveDuringResize: false })
          : false
      }
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
