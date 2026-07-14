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
  discussion: Accessor<HTMLElement | undefined>;
  editor: Accessor<LexicalEditor | undefined>;
  scrollContainer: Accessor<HTMLElement | undefined>;
}) {
  const [headings, setHeadings] = createSignal<OutlineHeading[]>([]);
  const [activeHeadingKey, setActiveHeadingKey] = createSignal<string>();
  const [discussionActive, setDiscussionActive] = createSignal(false);

  createEffect(() => {
    const discussion = props.discussion();
    const editor = props.editor();
    const scrollContainer = props.scrollContainer();
    if (!editor || !scrollContainer) return;

    let frame: number | undefined;

    const syncActiveHeading = () => {
      const currentHeadings = headings();
      const containerTop = scrollContainer.getBoundingClientRect().top;
      const activeLine = containerTop + ACTIVE_HEADING_OFFSET;
      const discussionIsActive =
        (discussion?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY) <=
          activeLine ||
        scrollContainer.scrollTop + scrollContainer.clientHeight >=
          scrollContainer.scrollHeight - 1;
      setDiscussionActive(discussionIsActive);
      if (discussionIsActive) {
        setActiveHeadingKey();
        return;
      }

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
    setDiscussionActive(false);
  };

  const scrollToDiscussion = () => {
    const discussion = props.discussion();
    if (!discussion) return;

    scrollToElement(discussion);
    setActiveHeadingKey();
    setDiscussionActive(true);
  };

  return (
    <Show when={headings().length > 0 || props.discussion()}>
      <nav aria-label="Document outline" class="w-52 py-1">
        <div class="flex flex-col gap-0.5">
          <For each={headings()}>
            {(heading) => (
              <button
                type="button"
                class="w-full truncate rounded-md border-l-2 border-transparent py-1 pr-2 text-left text-xs text-ink-muted transition-colors hover:bg-hover hover:text-ink"
                classList={{
                  'border-accent bg-accent/10 font-semibold text-ink':
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
          <Show when={props.discussion()}>
            <button
              type="button"
              class="mt-1 w-full truncate rounded-md border-edge-muted border-t border-l-2 border-l-transparent py-2 pr-2 pl-2 text-left text-xs text-ink-muted transition-colors hover:bg-hover hover:text-ink"
              classList={{
                'border-l-accent bg-accent/10 font-semibold text-ink':
                  discussionActive(),
              }}
              onClick={scrollToDiscussion}
            >
              Discussion
            </button>
          </Show>
        </div>
      </nav>
    </Show>
  );
}
