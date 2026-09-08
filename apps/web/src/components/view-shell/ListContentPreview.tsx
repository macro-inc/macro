import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { PreviewPanel } from '@components/app/PreviewPanel';
import { useRightPanelOwner } from '@components/app/right-panel-owner';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import type { EntityData } from '@entity';
import {
  createRenderEffect,
  createSignal,
  type JSX,
  on,
  onCleanup,
  Show,
  Suspense,
} from 'solid-js';
import { registerListPreview } from './list-preview-navigation';

/** Keep list navigation in place while its content opens in the shared preview. */
export function ListContentPreview(props: {
  title: JSX.Element;
  viewKey: string;
  children: () => JSX.Element;
}) {
  const panel = useSplitPanelOrThrow();
  const orchestrator = useGlobalBlockOrchestrator();
  const [selected, setSelected] = createSignal<EntityData>();
  useRightPanelOwner(() => {
    const item = selected();
    return item ? `${item.type}:${item.id}` : `list:${props.viewKey}`;
  });
  let content!: HTMLDivElement;
  let previousFocus: HTMLElement | undefined;
  let scrollPositions: Array<[number, number]> = [];
  const scrollElements = () =>
    [content, ...content.querySelectorAll<HTMLElement>('*')].filter(
      (el) => el.scrollHeight > el.clientHeight
    );
  const close = () => {
    setSelected(undefined);
    queueMicrotask(() => {
      scrollElements().forEach((el, index) => {
        const position = scrollPositions[index];
        if (position) el.scrollTo(...position);
      });
      if (previousFocus?.isConnected) previousFocus.focus();
      else content.focus();
    });
  };
  createRenderEffect(
    on(
      () => props.viewKey,
      () => {
        setSelected(undefined);
      },
      { defer: true }
    )
  );
  onCleanup(
    registerListPreview(panel.handle, (entity) => {
      if (!selected()) {
        previousFocus =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : undefined;
        scrollPositions = scrollElements().map((el) => [
          el.scrollLeft,
          el.scrollTop,
        ]);
      }
      setSelected(entity);
    })
  );
  return (
    <div
      ref={content}
      tabIndex={-1}
      class="flex size-full min-h-0 min-w-0 flex-col"
    >
      <Show when={!selected() ? 'list' : undefined}>
        {(_visible) => props.children()}
      </Show>
      <Show when={selected()}>
        {(entity) => (
          <Suspense
            fallback={
              <div class="px-4 py-4 text-sm text-ink-muted">Loading…</div>
            }
          >
            <PreviewPanel
              ref={(element) =>
                queueMicrotask(() => {
                  if (element.isConnected) element.focus();
                })
              }
              selectedEntity={entity()}
              orchestrator={orchestrator}
              splitPanelContext={panel}
              headerClass="h-12 min-h-12 gap-2 px-4 bg-panel"
              headerPrefix={
                <nav
                  aria-label="Breadcrumb"
                  class="flex shrink-0 items-center gap-2 text-sm"
                >
                  <button class="text-ink-muted hover:text-ink" onClick={close}>
                    {props.title}
                  </button>
                  <span aria-hidden="true" class="text-ink-extra-muted">
                    /
                  </span>
                </nav>
              }
            />
          </Suspense>
        )}
      </Show>
    </div>
  );
}
