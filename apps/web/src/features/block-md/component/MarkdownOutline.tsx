import { DocumentOutline } from '@app/components/DocumentOutline';
import { $isHeadingNode } from '@lexical/rich-text';
import { $getRoot, type LexicalEditor } from 'lexical';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

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
export const MARKDOWN_OUTLINE_INSET = 16;

export function shouldShowOutline(
  headingCount: number,
  enabled: boolean
): boolean {
  return enabled && headingCount >= MIN_OUTLINE_HEADINGS;
}

/**
 * Whether the rail fits in the margin left of the text column, given that
 * column's own distance from the notebook's left edge. The rail takes pointer
 * events, so fitting the notebook is not enough: checkbox markers are
 * `li::before` boxes drawn outside the list item and flush with the column's
 * left edge, and a rail reaching past the column swallows the click that would
 * tick one. The margin has to be measured rather than derived from the
 * notebook's width, because a comment layout pushes the column left without
 * making the notebook any narrower.
 */
export function outlineFitsGutter(contentInset: number): boolean {
  return contentInset >= MARKDOWN_OUTLINE_INSET + MARKDOWN_OUTLINE_WIDTH;
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
    <DocumentOutline
      label="Document outline"
      items={props.outline.headings()}
      activeKeys={visibleHeadingKeys()}
      viewportHeight={viewportCenter() * 2}
      portalMount={props.portalMount()}
      onSelect={(key) => {
        const heading = props.outline
          .headings()
          .find((heading) => heading.key === key);
        if (heading) scrollToHeading(heading);
      }}
    />
  );
}
