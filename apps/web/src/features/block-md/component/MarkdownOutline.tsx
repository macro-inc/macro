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
      class="flex h-6 w-6 items-center overflow-hidden rounded-md px-1 text-left text-xs text-ink-muted transition-[width,color,background-color] hover:bg-hover hover:text-ink group-hover/outline:w-full group-hover/outline:px-2 group-focus-within/outline:w-full group-focus-within/outline:px-2"
      classList={{ 'font-semibold text-ink': props.active }}
      onClick={props.onClick}
    >
      <span
        aria-hidden="true"
        class={
          props.active
            ? 'h-0.5 w-3 shrink-0 rounded-full bg-ink transition-[width,background-color] group-hover/outline:hidden group-focus-within/outline:hidden'
            : 'h-0.5 w-2 shrink-0 rounded-full bg-ink/20 transition-[width,background-color] group-hover/outline:hidden group-focus-within/outline:hidden'
        }
      />
      <span class="hidden min-w-0 truncate group-hover/outline:block group-focus-within/outline:block">
        {props.label}
      </span>
    </button>
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
      <nav
        aria-label="Document outline"
        class="group/outline w-6 overflow-visible py-1 transition-[width] hover:w-52 hover:rounded-xl hover:bg-surface hover:p-2 hover:shadow-menu hover:ring hover:ring-edge focus-within:w-52 focus-within:rounded-xl focus-within:bg-surface focus-within:p-2 focus-within:shadow-menu focus-within:ring focus-within:ring-edge"
      >
        <div class="flex flex-col gap-0.5">
          <For each={headings()}>
            {(heading) => (
              <OutlineItem
                active={activeHeadingKey() === heading.key}
                label={heading.text}
                onClick={() => scrollToHeading(heading)}
              />
            )}
          </For>
          <Show when={props.discussion()}>
            <OutlineItem
              active={discussionActive()}
              label="Discussion"
              onClick={scrollToDiscussion}
            />
          </Show>
        </div>
      </nav>
    </Show>
  );
}
