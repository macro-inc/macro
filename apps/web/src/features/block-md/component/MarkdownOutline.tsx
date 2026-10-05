import { HoverCard } from '@core/component/HoverCard';
import { $isHeadingNode } from '@lexical/rich-text';
import { $getRoot, type LexicalEditor } from 'lexical';
import {
  type Accessor,
  createEffect,
  createSignal,
  For,
  onCleanup,
  Show,
} from 'solid-js';

type OutlineHeading = {
  key: string;
  level: number;
  text: string;
  preview: string;
};

const HEADING_SCROLL_OFFSET = 80;
const SECTION_PREVIEW_LENGTH = 240;
const MIN_OUTLINE_HEADINGS = 3;
export const MARKDOWN_OUTLINE_WIDTH = 40;

export function shouldShowOutline(
  headingCount: number,
  enabled: boolean
): boolean {
  return enabled && headingCount >= MIN_OUTLINE_HEADINGS;
}

/** A section runs from its heading to the next heading (or the editor end). */
export function getVisibleHeadingIndexes(
  headingTops: number[],
  documentBottom: number,
  viewportTop: number,
  viewportBottom: number
): number[] {
  if (viewportBottom <= viewportTop) return [];

  return headingTops.flatMap((top, index) => {
    const bottom = headingTops[index + 1] ?? documentBottom;
    return top < viewportBottom && bottom > viewportTop && bottom > top
      ? [index]
      : [];
  });
}

function headingsEqual(a: OutlineHeading[], b: OutlineHeading[]) {
  return (
    a.length === b.length &&
    a.every(
      (heading, index) =>
        heading.key === b[index]?.key &&
        heading.level === b[index]?.level &&
        heading.text === b[index]?.text &&
        heading.preview === b[index]?.preview
    )
  );
}

export function useMarkdownOutline(props: {
  editor: Accessor<LexicalEditor | undefined>;
  enabled: Accessor<boolean>;
}) {
  const [headings, setHeadings] = createSignal<OutlineHeading[]>([]);

  createEffect(() => {
    const editor = props.editor();
    if (!editor) {
      setHeadings([]);
      return;
    }

    const refreshHeadings = () => {
      const nextHeadings = editor.getEditorState().read(() => {
        const sections: OutlineHeading[] = [];
        for (const node of $getRoot().getChildren()) {
          const text = node.getTextContent().trim();
          if ($isHeadingNode(node) && text) {
            sections.push({
              key: node.getKey(),
              level: Number(node.getTag().slice(1)),
              text,
              preview: '',
            });
          } else {
            const section = sections.at(-1);
            if (section && section.preview.length < SECTION_PREVIEW_LENGTH) {
              section.preview = `${section.preview} ${text}`
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, SECTION_PREVIEW_LENGTH);
            }
          }
        }
        return sections;
      });

      setHeadings((current) =>
        headingsEqual(current, nextHeadings) ? current : nextHeadings
      );
    };

    refreshHeadings();
    onCleanup(editor.registerUpdateListener(refreshHeadings));
  });

  return {
    headings,
    show: () => shouldShowOutline(headings().length, props.enabled()),
  };
}

type MarkdownOutlineState = ReturnType<typeof useMarkdownOutline>;

export function MarkdownOutline(props: {
  editor: Accessor<LexicalEditor | undefined>;
  outline: MarkdownOutlineState;
  portalMount: Accessor<HTMLElement>;
  scrollContainer: Accessor<HTMLElement | undefined>;
}) {
  const [visibleHeadingKeys, setVisibleHeadingKeys] = createSignal<Set<string>>(
    new Set()
  );
  const [hoveredIndex, setHoveredIndex] = createSignal<number>();
  const [viewportCenter, setViewportCenter] = createSignal(0);

  createEffect(() => {
    const scrollContainer = props.scrollContainer();
    if (!scrollContainer) return;

    const syncViewportCenter = () => {
      setViewportCenter(scrollContainer.clientHeight / 2);
    };
    const resizeObserver = new ResizeObserver(syncViewportCenter);
    syncViewportCenter();
    resizeObserver.observe(scrollContainer);
    onCleanup(() => resizeObserver.disconnect());
  });

  createEffect(() => {
    const editor = props.editor();
    const scrollContainer = props.scrollContainer();
    const currentHeadings = props.outline.headings();
    if (!editor || !scrollContainer) return;

    let frame: number | undefined;

    const syncVisibleHeadings = () => {
      const root = editor.getRootElement();
      const containerRect = scrollContainer.getBoundingClientRect();
      const viewportTop = Math.max(
        0,
        containerRect.top + scrollContainer.clientTop
      );
      const viewportBottom = Math.min(
        window.innerHeight,
        containerRect.top +
          scrollContainer.clientTop +
          scrollContainer.clientHeight
      );
      const renderedHeadings = currentHeadings.flatMap((heading) => {
        const element = editor.getElementByKey(heading.key);
        return element
          ? [{ key: heading.key, top: element.getBoundingClientRect().top }]
          : [];
      });
      const indexes = getVisibleHeadingIndexes(
        renderedHeadings.map((heading) => heading.top),
        root?.getBoundingClientRect().bottom ?? viewportTop,
        viewportTop,
        viewportBottom
      );
      setVisibleHeadingKeys(
        new Set(indexes.map((index) => renderedHeadings[index].key))
      );
    };

    const queueViewportSync = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        syncVisibleHeadings();
      });
    };
    const resizeObserver = new ResizeObserver(queueViewportSync);
    resizeObserver.observe(scrollContainer);
    const unregisterRootListener = editor.registerRootListener(
      (root, previousRoot) => {
        if (previousRoot) resizeObserver.unobserve(previousRoot);
        if (root) resizeObserver.observe(root);
        queueViewportSync();
      }
    );
    const unregisterUpdateListener =
      editor.registerUpdateListener(queueViewportSync);
    queueViewportSync();
    scrollContainer.addEventListener('scroll', queueViewportSync, {
      passive: true,
    });
    window.addEventListener('resize', queueViewportSync);
    onCleanup(() => {
      unregisterRootListener();
      unregisterUpdateListener();
      resizeObserver.disconnect();
      scrollContainer.removeEventListener('scroll', queueViewportSync);
      window.removeEventListener('resize', queueViewportSync);
      if (frame !== undefined) cancelAnimationFrame(frame);
    });
  });

  const scrollToElement = (element: HTMLElement) => {
    const scrollContainer = props.scrollContainer();
    if (!scrollContainer) return;

    const containerTop = scrollContainer.getBoundingClientRect().top;
    const elementTop = element.getBoundingClientRect().top;
    scrollContainer.scrollTo({
      top:
        scrollContainer.scrollTop +
        elementTop -
        containerTop -
        HEADING_SCROLL_OFFSET,
      behavior: 'instant',
    });
  };

  const scrollToHeading = (heading: OutlineHeading) => {
    const headingElement = props.editor()?.getElementByKey(heading.key);
    if (!headingElement) return;

    scrollToElement(headingElement);
  };

  return (
    <nav
      aria-label="Document outline"
      class="pointer-events-auto sticky z-1 w-7 -translate-y-1/2"
      style={{ top: `${viewportCenter()}px` }}
    >
      <div
        class="flex w-7 flex-col items-start overflow-y-auto py-1"
        style={{ 'max-height': `${Math.max(0, viewportCenter() * 2 - 32)}px` }}
      >
        <For each={props.outline.headings()}>
          {(heading, index) => {
            const active = () => visibleHeadingKeys().has(heading.key);
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
                      {heading.text}
                    </div>
                    <Show when={heading.preview}>
                      <p class="mt-1 line-clamp-3 text-sm leading-relaxed text-ink-muted">
                        {heading.preview}
                      </p>
                    </Show>
                  </div>
                }
                contentZIndexClass="z-item-options-menu"
                gutter={10}
                placement="right"
                portalMount={props.portalMount()}
                trigger={
                  <button
                    type="button"
                    aria-label={heading.text}
                    aria-current={active() ? 'location' : undefined}
                    class="flex h-2.5 w-7 items-center outline-none focus-visible:rounded-sm focus-visible:ring-1 focus-visible:ring-ink"
                    onFocus={() => setHoveredIndex(index())}
                    onBlur={() =>
                      setHoveredIndex((current) =>
                        current === index() ? undefined : current
                      )
                    }
                    onClick={() => scrollToHeading(heading)}
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
        </For>
      </div>
    </nav>
  );
}
