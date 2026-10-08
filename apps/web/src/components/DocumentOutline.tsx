import { HoverCard } from '@core/component/HoverCard';
import { Key } from '@solid-primitives/keyed';
import { createSignal, Show } from 'solid-js';

export type DocumentOutlineItem = {
  key: string;
  text: string;
  preview: string;
};

/** The compact outline rail shared by documents and form builders. */
export function DocumentOutline(props: {
  label: string;
  items: DocumentOutlineItem[];
  activeKeys: ReadonlySet<string>;
  viewportHeight: number;
  portalMount: HTMLElement;
  onSelect: (key: string) => void;
}) {
  const [hoveredIndex, setHoveredIndex] = createSignal<number>();
  return (
    <nav
      aria-label={props.label}
      class="pointer-events-auto sticky z-1 w-7 -translate-y-1/2"
      style={{ top: `${props.viewportHeight / 2}px` }}
    >
      <div
        class="flex w-7 flex-col items-start overflow-y-auto py-1"
        style={{
          'max-height': `${Math.max(0, props.viewportHeight - 32)}px`,
        }}
      >
        <Key each={props.items} by="key">
          {(heading, index) => {
            const active = () => props.activeKeys.has(heading().key);
            const distance = () =>
              Math.abs(index() - (hoveredIndex() ?? Number.POSITIVE_INFINITY));
            const width = () => [26, 20, 14, 10][distance()] ?? 6;
            const emphasized = () =>
              hoveredIndex() === undefined ? active() : distance() === 0;

            return (
              <HoverCard
                closeDelay={80}
                closeOnScroll={false}
                keepOpenOnTriggerPress
                openDelay={0}
                open={hoveredIndex() === index()}
                onOpenChange={(open) => {
                  setHoveredIndex((current) =>
                    open ? index() : current === index() ? undefined : current
                  );
                }}
                content={
                  <div class="w-80 max-w-[calc(100vw-3rem)] rounded-xl border border-edge bg-surface px-3 py-2 shadow-menu">
                    <div class="truncate text-sm font-medium text-ink">
                      {heading().text}
                    </div>
                    <Show when={heading().preview}>
                      <p class="mt-1 line-clamp-3 text-sm leading-relaxed text-ink-muted">
                        {heading().preview}
                      </p>
                    </Show>
                  </div>
                }
                contentZIndexClass="z-item-options-menu"
                gutter={10}
                // Previews must not intercept clicks on controls beside the rail.
                passThroughPointerEvents
                placement="right"
                portalMount={props.portalMount}
                trigger={
                  <button
                    type="button"
                    aria-label={heading().text}
                    aria-current={active() ? 'location' : undefined}
                    class="flex h-2.5 w-7 items-center outline-none focus-visible:rounded-sm focus-visible:ring-1 focus-visible:ring-ink"
                    onFocus={() => setHoveredIndex(index())}
                    onBlur={() =>
                      setHoveredIndex((current) =>
                        current === index() ? undefined : current
                      )
                    }
                    onClick={() => props.onSelect(heading().key)}
                  >
                    <span
                      aria-hidden="true"
                      class="h-0.5 shrink-0 transition-[width,background-color] duration-150 ease-out motion-reduce:transition-none"
                      classList={{
                        'bg-ink': emphasized(),
                        'bg-ink/20': !emphasized(),
                      }}
                      style={{ width: `${width()}px` }}
                    />
                  </button>
                }
                triggerClass="block w-7"
                triggerTabIndex={-1}
              />
            );
          }}
        </Key>
      </div>
    </nav>
  );
}
