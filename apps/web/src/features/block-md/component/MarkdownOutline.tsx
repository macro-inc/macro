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
};

const ACTIVE_HEADING_OFFSET = 80;
const MIN_OUTLINE_HEADINGS = 3;

export function shouldShowOutline(headingCount: number): boolean {
  return headingCount >= MIN_OUTLINE_HEADINGS;
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
  scrollContainer: Accessor<HTMLElement | undefined>;
}) {
  const [headings, setHeadings] = createSignal<OutlineHeading[]>([]);
  const [activeHeadingKey, setActiveHeadingKey] = createSignal<string>();

  createEffect(() => {
    const editor = props.editor();
    const scrollContainer = props.scrollContainer();
    if (!editor || !scrollContainer) return;

    let frame: number | undefined;

    const syncActiveHeading = () => {
      const currentHeadings = headings();
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

    const queueActiveHeadingSync = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(syncActiveHeading);
    };

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
      queueActiveHeadingSync();
    };

    refreshHeadings();
    const unregisterUpdateListener =
      editor.registerUpdateListener(refreshHeadings);
    scrollContainer.addEventListener('scroll', queueActiveHeadingSync, {
      passive: true,
    });
    window.addEventListener('resize', queueActiveHeadingSync);

    onCleanup(() => {
      unregisterUpdateListener();
      scrollContainer.removeEventListener('scroll', queueActiveHeadingSync);
      window.removeEventListener('resize', queueActiveHeadingSync);
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
    <Show when={shouldShowOutline(headings().length)}>
      <nav
        aria-label="Document outline"
        class="group/outline relative w-3 outline-none"
        tabIndex={0}
      >
        <div
          aria-hidden="true"
          class="flex w-3 flex-col items-start gap-1 py-1"
        >
          <For each={headings()}>
            {(heading) => (
              <OutlineDash active={activeHeadingKey() === heading.key} />
            )}
          </For>
        </div>
        <div class="invisible absolute top-0 left-0 z-1 max-h-[calc(100vh-6rem)] w-52 overflow-y-auto rounded-xl bg-surface p-2 shadow-menu ring ring-edge group-hover/outline:visible group-focus-within/outline:visible">
          <For each={headings()}>
            {(heading) => (
              <OutlineItem
                active={activeHeadingKey() === heading.key}
                label={heading.text}
                onClick={() => scrollToHeading(heading)}
              />
            )}
          </For>
        </div>
      </nav>
    </Show>
  );
}
