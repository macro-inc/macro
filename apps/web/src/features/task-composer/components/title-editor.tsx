import { EmojiMenu } from '@core/component/LexicalMarkdown/component/menu/EmojiMenu';
import { TagsMenu } from '@core/component/LexicalMarkdown/component/menu/TagsMenu';
import { createLexicalWrapper } from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import {
  autoRegister,
  emojisPlugin,
  singleLinePlugin,
  tagsPlugin,
} from '@core/component/LexicalMarkdown/plugins';
import type { TagMentionLifecycle } from '@core/component/LexicalMarkdown/plugins/tags';
import { createMenuOperations } from '@core/component/LexicalMarkdown/shared/inlineMenu';
import {
  $getCaretRect,
  focusEditorWithoutScroll,
  forceSetTextContent,
  initializeEditorEmpty,
  isRectFlushWith,
  trimWhitespace,
} from '@core/component/LexicalMarkdown/utils';
import type { PortalScope } from '@core/component/ScopedPortal';
import { onElementConnect } from '@core/util/onElementConnect';
import { mergeRegister } from '@lexical/utils';
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_NORMAL,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type LexicalEditor,
} from 'lexical';
import {
  type Accessor,
  createEffect,
  createSignal,
  type JSX,
  on,
  onCleanup,
  Show,
  untrack,
} from 'solid-js';

/**
 * Wrapper for controls that sit beside the composer title (the inline tags
 * pill) so they stay centered on the title's *first* line rather than drifting
 * to the middle of a title that wraps onto several lines. `h-7` matches the
 * `text-xl/7` line box of {@link ComposeTaskTitleEditor}; keep the two in sync.
 */
export function TaskTitleAccessory(props: { children: JSX.Element }) {
  return <div class="flex h-7 shrink-0 items-center">{props.children}</div>;
}

function composerTitleNavigationPlugin(
  bodyEditor: Accessor<LexicalEditor | undefined>,
  ignoreNavigation: Accessor<boolean>,
  onSubmit?: () => void
) {
  const focusBodyStart = (event: KeyboardEvent | null) => {
    if (ignoreNavigation()) return true;
    if (
      event?.key === 'Enter' &&
      (event.metaKey || event.ctrlKey) &&
      onSubmit
    ) {
      event.preventDefault();
      event.stopPropagation();
      onSubmit();
      return true;
    }
    const editor = bodyEditor();
    if (!editor) return false;
    event?.preventDefault();
    event?.stopPropagation();
    editor.update(() => {
      const firstChild = $getRoot().getFirstChild();
      firstChild?.selectStart();
    });
    editor.focus();
    return true;
  };

  return (titleEditor: LexicalEditor) =>
    mergeRegister(
      titleEditor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => focusBodyStart(event),
        COMMAND_PRIORITY_NORMAL
      ),
      titleEditor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (event) => {
          if (ignoreNavigation()) return true;
          const rect = titleEditor.getRootElement()?.getBoundingClientRect();
          if (!rect) return false;
          const caret = $getCaretRect() ?? rect;
          if (!isRectFlushWith(caret, rect, 'bottom', 5)) return false;
          return focusBodyStart(event);
        },
        COMMAND_PRIORITY_NORMAL
      ),
      titleEditor.registerCommand(
        KEY_ARROW_RIGHT_COMMAND,
        (event) => {
          if (ignoreNavigation()) return true;
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
            return false;
          }
          const anchorNode = selection.anchor.getNode();
          const len = anchorNode.getTextContent().length;
          if (selection.anchor.offset !== len) return false;
          if (anchorNode.getParent()?.getLastChild() !== anchorNode) {
            return false;
          }
          return focusBodyStart(event);
        },
        COMMAND_PRIORITY_NORMAL
      )
    );
}

function isTitleSelectionAtStart() {
  const selection = $getSelection();
  if (
    !$isRangeSelection(selection) ||
    !selection.isCollapsed() ||
    selection.anchor.offset !== 0
  ) {
    return false;
  }

  const root = $getRoot();
  let topLevel = selection.anchor.getNode();
  while (topLevel.getParent() !== root) {
    const parent = topLevel.getParent();
    if (!parent) return false;
    topLevel = parent;
  }

  let previous = topLevel.getPreviousSibling();
  while (previous) {
    if (previous.getTextContent().length > 0) return false;
    previous = previous.getPreviousSibling();
  }

  return true;
}

export function ComposeTaskTitleEditor(props: {
  placeholder?: string;
  label?: string;
  value: Accessor<string>;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  disabled: Accessor<boolean>;
  bodyEditor?: Accessor<LexicalEditor | undefined>;
  containerRef?: Accessor<HTMLDivElement | undefined>;
  onUserInput?: () => void;
  onTagSelected?: (tag: TagMentionLifecycle) => void;
  onDeleteTagsAtStart?: () => boolean;
  portalScope?: PortalScope;
  ref?: (el: HTMLDivElement) => void;
  /** Focus the title once its editor attaches, with the caret after its text. */
  autofocus?: boolean;
}) {
  const [state, setState] = createSignal(props.value());
  const [showPlaceholder, setShowPlaceholder] = createSignal(
    props.value().trim() === ''
  );
  const [rootConnected, setRootConnected] = createSignal(false);

  const { editor, plugins, cleanup } = createLexicalWrapper({
    namespace: 'task-composer-title',
    type: 'title',
    isInteractable: () => !props.disabled(),
  });
  onCleanup(() => {
    trimWhitespace(editor, { trailing: true });
    cleanup();
  });

  const emojiMenuOperations = createMenuOperations();
  const tagMenuOperations = createMenuOperations();
  const inlineMenuOpen = () =>
    emojiMenuOperations.isOpen() || tagMenuOperations.isOpen();

  initializeEditorEmpty(editor);
  forceSetTextContent(editor, props.value());

  plugins
    .plainText()
    .history(400)
    .use(singleLinePlugin())
    .use(emojisPlugin({ menu: emojiMenuOperations }))
    .use(
      composerTitleNavigationPlugin(
        () => props.bodyEditor?.(),
        inlineMenuOpen,
        props.onSubmit
      )
    )
    .state<string>(setState, 'plain');

  if (props.onTagSelected) {
    plugins.use(
      tagsPlugin({
        menu: tagMenuOperations,
        insertTags: false,
        onCreateTag: props.onTagSelected,
      })
    );
  }

  plugins.onUpdate(({ editorState }) => {
    if (!editorState) return;
    setShowPlaceholder(
      editorState.read(() => $getRoot().getTextContent().trim() === '')
    );
  });

  createEffect(() => {
    editor.setEditable(!props.disabled());
  });

  createEffect(
    on(
      state,
      (next) => {
        if (next === props.value()) return;
        props.onUserInput?.();
        props.onChange(next);
      },
      { defer: true }
    )
  );

  createEffect(() => {
    const next = props.value();
    if (!untrack(rootConnected)) return;
    if (next === untrack(state)) return;
    forceSetTextContent(editor, next);
  });

  autoRegister(
    mergeRegister(
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        (event) => {
          if (!isTitleSelectionAtStart()) return false;
          if (!props.onDeleteTagsAtStart?.()) return false;
          event?.preventDefault();
          event?.stopPropagation();
          return true;
        },
        COMMAND_PRIORITY_NORMAL
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (event) => {
          props.containerRef?.()?.focus();
          event?.preventDefault();
          event?.stopPropagation();
          return true;
        },
        COMMAND_PRIORITY_NORMAL
      )
    )
  );

  const onConnect = (el: HTMLDivElement) => {
    editor.setRootElement(el);
    setRootConnected(true);
    if (props.autofocus) {
      editor.update(() => $getRoot().selectEnd(), { discrete: true });
      focusEditorWithoutScroll(editor);
    }
  };

  return (
    <div class="relative w-full">
      <div
        role="textbox"
        aria-label={props.label ?? 'Title'}
        contentEditable={!props.disabled()}
        class="ph-no-capture w-full text-xl/7 font-medium outline-none whitespace-pre-wrap wrap-break-word [&_p]:my-0! [&_p:empty]:min-h-7"
        ref={(el) => {
          props.ref?.(el);
          onElementConnect(el, () => onConnect(el));
        }}
      />
      <EmojiMenu
        editor={editor}
        menu={emojiMenuOperations}
        useBlockBoundary={true}
        portalScope={props.portalScope}
      />
      <Show when={props.onTagSelected}>
        <TagsMenu
          editor={editor}
          menu={tagMenuOperations}
          useBlockBoundary={true}
          portalScope={props.portalScope}
        />
      </Show>
      <Show when={showPlaceholder()}>
        <div class="pointer-events-none absolute top-0 text-xl/7 font-medium text-ink-placeholder">
          {props.placeholder ?? 'New task'}
        </div>
      </Show>
    </div>
  );
}
