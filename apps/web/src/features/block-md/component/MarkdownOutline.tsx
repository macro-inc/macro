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
      const headingTops = currentHeadings.map(
        (heading) =>
          editor.getElementByKey(heading.key)?.getBoundingClientRect().top ??
          Number.POSITIVE_INFINITY
      );
      const activeIndex = getActiveHeadingIndex(
        headingTops,
        containerTop + ACTIVE_HEADING_OFFSET
      );
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

  const scrollToHeading = (heading: OutlineHeading) => {
    const editor = props.editor();
    const scrollContainer = props.scrollContainer();
    const headingElement = editor?.getElementByKey(heading.key);
    if (!headingElement || !scrollContainer) return;

    const containerTop = scrollContainer.getBoundingClientRect().top;
    const headingTop = headingElement.getBoundingClientRect().top;
    scrollContainer.scrollTo({
      top:
        scrollContainer.scrollTop +
        headingTop -
        containerTop -
        ACTIVE_HEADING_OFFSET,
      behavior: 'smooth',
    });
    setActiveHeadingKey(heading.key);
  };

  return (
    <Show when={headings().length > 0}>
      <nav aria-label="Document outline" class="w-52 py-1">
        <div class="mb-2 px-2 text-xs font-medium text-ink-muted">Outline</div>
        <div class="flex flex-col gap-0.5">
          <For each={headings()}>
            {(heading) => (
              <button
                type="button"
                class="w-full truncate rounded-md border-l-2 border-transparent py-1 pr-2 text-left text-xs text-ink-muted transition-colors hover:bg-hover hover:text-ink"
                classList={{
                  'border-accent bg-accent/10 text-ink':
                    activeHeadingKey() === heading.key,
                }}
                style={{
                  'padding-left': `${8 + (heading.level - 1) * 12}px`,
                }}
                title={heading.text}
                onClick={() => scrollToHeading(heading)}
              >
                {heading.text}
              </button>
            )}
          </For>
        </div>
      </nav>
    </Show>
  );
}
