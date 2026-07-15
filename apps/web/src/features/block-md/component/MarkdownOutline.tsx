import { HoverCard } from '@core/component/HoverCard';
import { $isHeadingNode } from '@lexical/rich-text';
import { $getRoot, type LexicalEditor } from 'lexical';
import {
  type Accessor,
  createEffect,
  createSignal,
  For,
  onCleanup,
} from 'solid-js';

type OutlineHeading = {
  key: string;
  level: number;
  text: string;
};

const ACTIVE_HEADING_OFFSET = 80;
const MIN_OUTLINE_HEADINGS = 3;
export const MARKDOWN_OUTLINE_WIDTH = 40;

export function shouldShowOutline(
  headingCount: number,
  enabled: boolean
): boolean {
  return enabled && headingCount >= MIN_OUTLINE_HEADINGS;
}

export function getActiveHeadingIndex(
  headingTops: number[],
  activeLine: number
): number {
  if (headingTops.length === 0) return -1;

  let activeIndex = 0;
  for (const [index, top] of headingTops.entries()) {
    if (top > activeLine) break;
    activeIndex = index;
  }
  return activeIndex;
}

function headingsEqual(a: OutlineHeading[], b: OutlineHeading[]) {
  return (
    a.length === b.length &&
    a.every(
      (heading, index) =>
        heading.key === b[index]?.key &&
        heading.level === b[index]?.level &&
        heading.text === b[index]?.text
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
      const nextHeadings = editor.getEditorState().read(() =>
        $getRoot()
          .getChildren()
          .filter($isHeadingNode)
          .map((node) => ({
            key: node.getKey(),
            level: Number(node.getTag().slice(1)),
            text: node.getTextContent().trim(),
          }))
          .filter((heading) => heading.text.length > 0)
      );

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

function OutlineDash(props: { active: boolean }) {
  return (
    <span
      class={
        props.active
          ? 'h-px w-3 rounded-full bg-accent'
          : 'h-px w-2 rounded-full bg-ink/20'
      }
    />
  );
}

function OutlineItem(props: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      aria-current={props.active ? 'location' : undefined}
      class="h-7 w-full truncate rounded-md px-2 text-left text-xs text-ink-muted hover:bg-hover hover:text-ink"
      classList={{ 'font-semibold text-accent': props.active }}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

export function MarkdownOutline(props: {
  editor: Accessor<LexicalEditor | undefined>;
  outline: MarkdownOutlineState;
  portalMount: Accessor<HTMLElement>;
  scrollContainer: Accessor<HTMLElement | undefined>;
}) {
  const [activeHeadingKey, setActiveHeadingKey] = createSignal<string>();
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

    const syncActiveHeading = () => {
      const containerTop = scrollContainer.getBoundingClientRect().top;
      const activeLine = containerTop + ACTIVE_HEADING_OFFSET;
      const headingTops = currentHeadings.map(
        (heading) =>
          editor.getElementByKey(heading.key)?.getBoundingClientRect().top ??
          Number.POSITIVE_INFINITY
      );
      const activeIndex = getActiveHeadingIndex(headingTops, activeLine);
      setActiveHeadingKey(currentHeadings[activeIndex]?.key);
    };

    const queueViewportSync = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        syncActiveHeading();
      });
    };
    queueViewportSync();
    scrollContainer.addEventListener('scroll', queueViewportSync, {
      passive: true,
    });
    onCleanup(() => {
      scrollContainer.removeEventListener('scroll', queueViewportSync);
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
        ACTIVE_HEADING_OFFSET,
      behavior: 'smooth',
    });
  };

  const scrollToHeading = (heading: OutlineHeading) => {
    const headingElement = props.editor()?.getElementByKey(heading.key);
    if (!headingElement) return;

    scrollToElement(headingElement);
    setActiveHeadingKey(heading.key);
  };

  return (
    <div
      class="pointer-events-auto sticky z-1 w-3 -translate-y-1/2"
      style={{ top: `${viewportCenter()}px` }}
    >
      <HoverCard
        closeDelay={0}
        content={
          <div class="max-h-[calc(100vh-6rem)] w-52 overflow-y-auto rounded-xl bg-surface p-2 shadow-menu ring ring-edge">
            <For each={props.outline.headings()}>
              {(heading) => (
                <OutlineItem
                  active={activeHeadingKey() === heading.key}
                  label={heading.text}
                  onClick={() => scrollToHeading(heading)}
                />
              )}
            </For>
          </div>
        }
        contentZIndexClass="z-item-options-menu"
        gutter={-12}
        openDelay={0}
        placement="right"
        portalMount={props.portalMount()}
        trigger={
          <div
            aria-hidden="true"
            class="flex w-3 flex-col items-start gap-2 py-1"
          >
            <For each={props.outline.headings()}>
              {(heading) => (
                <OutlineDash active={activeHeadingKey() === heading.key} />
              )}
            </For>
          </div>
        }
        triggerAriaLabel="Document outline"
        triggerAs="nav"
        triggerClass="w-3 outline-none"
        triggerTabIndex={0}
      />
    </div>
  );
}
