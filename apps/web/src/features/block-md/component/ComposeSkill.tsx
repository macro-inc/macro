import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { createLexicalWrapper } from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import {
  autoRegister,
  singleLinePlugin,
} from '@core/component/LexicalMarkdown/plugins';
import {
  $getCaretRect,
  forceSetTextContent,
  initializeEditorEmpty,
  isRectFlushWith,
  trimWhitespace,
} from '@core/component/LexicalMarkdown/utils';
import type { PortalScope } from '@core/component/ScopedPortal';
import { toast } from '@core/component/Toast/Toast';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { createSkill } from '@core/util/create';
import { buildSimpleEntityUrl } from '@core/util/url';
import { mergeRegister } from '@lexical/utils';
import ArrowSquareOutIcon from '@phosphor/arrow-square-out.svg';
import ArrowsOutIcon from '@phosphor/arrows-out.svg';
import SplitIcon from '@phosphor/square-half.svg';
import XIcon from '@phosphor/x.svg';
import { onElementConnect } from '@solid-primitives/lifecycle';
import { Button, Hotkey, Scroll } from '@ui';
import {
  $getRoot,
  COMMAND_PRIORITY_NORMAL,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type LexicalEditor,
} from 'lexical';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';

function composerTitleNavigationPlugin(
  bodyEditor: Accessor<LexicalEditor | undefined>
) {
  const focusBodyStart = (event: KeyboardEvent | null) => {
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
          const rect = titleEditor.getRootElement()?.getBoundingClientRect();
          if (!rect) return false;
          const caret = $getCaretRect() ?? rect;
          if (!isRectFlushWith(caret, rect, 'bottom', 5)) return false;
          return focusBodyStart(event);
        },
        COMMAND_PRIORITY_NORMAL
      )
    );
}

function ComposeSkillTitleEditor(props: {
  value: Accessor<string>;
  onChange: (value: string) => void;
  disabled: Accessor<boolean>;
  bodyEditor: Accessor<LexicalEditor | undefined>;
  containerRef: Accessor<HTMLDivElement | undefined>;
  onUserInput: () => void;
  ref?: (el: HTMLDivElement) => void;
}) {
  const [state, setState] = createSignal(props.value());
  const [showPlaceholder, setShowPlaceholder] = createSignal(
    props.value().trim() === ''
  );
  const [rootConnected, setRootConnected] = createSignal(false);

  const { editor, plugins, cleanup } = createLexicalWrapper({
    namespace: 'skill-composer-title',
    type: 'title',
    isInteractable: () => !props.disabled(),
  });

  initializeEditorEmpty(editor);
  forceSetTextContent(editor, props.value());

  plugins
    .plainText()
    .history(400)
    .use(singleLinePlugin())
    .use(composerTitleNavigationPlugin(props.bodyEditor))
    .state<string>(setState, 'plain');

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
        props.onUserInput();
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
    editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (event) => {
        props.containerRef()?.focus();
        event?.preventDefault();
        event?.stopPropagation();
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    )
  );

  const onConnect = (el: HTMLDivElement) => {
    editor.setRootElement(el);
    setRootConnected(true);
    onCleanup(() => {
      trimWhitespace(editor, { trailing: true });
      cleanup();
    });
  };

  return (
    <div class="relative w-full">
      <div
        contentEditable={!props.disabled()}
        class="ph-no-capture w-full text-xl font-medium outline-none whitespace-pre-wrap wrap-break-word"
        ref={(el) => {
          props.ref?.(el);
          onElementConnect(el, () => onConnect(el));
        }}
      />
      <Show when={showPlaceholder()}>
        <div class="pointer-events-none absolute top-1.5 text-xl font-medium text-ink-placeholder">
          New skill
        </div>
      </Show>
    </div>
  );
}

export type ComposeSkillSuccess = {
  documentId: string;
  title: string;
  content: string;
};

export interface ComposeSkillProps {
  onClose?: () => void;
  initialTitle?: string;
  initialContent?: string;
  placeholder?: string;
  /**
   * When provided, replaces the default success behavior (auto-copy link +
   * toast) so the caller can handle the created skill however it needs.
   * Also fires when the skill is created via "Continue editing in split".
   */
  onSuccess?: (result: ComposeSkillSuccess) => void;
}

/**
 * Popover dialog for creating a skill — a trimmed-down sibling of
 * [`ComposeTask`]: just a name, markdown instructions, and a create button.
 * Skills have no properties, tags, or assignees, so none of that appears.
 */
export function ComposeSkill(props: ComposeSkillProps) {
  const splitPanel = useSplitPanelOrThrow();
  const { openWithSplit } = useSplitLayout();

  const [title, setTitle] = createSignal(props.initialTitle ?? '');
  const [content, setContent] = createSignal(props.initialContent ?? '');
  const [bodyEditor, setBodyEditor] = createSignal<LexicalEditor>();
  const [containerRef, setContainerRef] = createSignal<HTMLDivElement>();
  const [attachHotkeys, composeHotkeyScope] = useHotkeyDOMScope(
    'compose-skill',
    true
  );
  const [errorMessage, setErrorMessage] = createSignal<string>('');
  const [isCreating, setIsCreating] = createSignal(false);

  const showSkillCreatedToast = async (documentId: string) => {
    const url = buildSimpleEntityUrl({ type: 'skill', id: documentId });
    let linkCopied = false;
    try {
      await navigator.clipboard.writeText(url);
      linkCopied = true;
    } catch {
      toast.failure('Failed to copy link to clipboard');
    }

    toast.success('Skill created', {
      subtext: linkCopied ? 'Link copied' : undefined,
      actions: [
        {
          label: 'Open',
          icon: ArrowSquareOutIcon,
          onClick: () => {
            openWithSplit(
              { type: 'skill', id: documentId },
              { referredFrom: null }
            );
          },
        },
        {
          label: 'Open (New Split)',
          icon: SplitIcon,
          onClick: () => {
            openWithSplit(
              { type: 'skill', id: documentId },
              { referredFrom: null, preferNewSplit: true }
            );
          },
        },
      ],
    });
  };

  // Unlike ComposeTask there is no draft persistence, so the dialog stays
  // open while the create request is in flight — a failure keeps the user's
  // input instead of dropping it.
  const submitSkill = async () => {
    const skillTitle = title().trim();
    const skillContent = content().trim();

    setIsCreating(true);
    const documentId = await createSkill({
      title: skillTitle,
      content: skillContent,
      source: 'skill_composer',
    });
    setIsCreating(false);

    if (!documentId) {
      toast.failure('Failed to create Skill');
      return null;
    }

    splitPanel.handle.close();
    props.onClose?.();
    props.onSuccess?.({
      documentId,
      title: skillTitle,
      content: skillContent,
    });
    return documentId;
  };

  const handleCreateSkill = async () => {
    if (isCreating()) return;

    if (!title().trim()) {
      setErrorMessage('Please give this skill a name');
      return;
    }
    setErrorMessage('');

    const documentId = await submitSkill();
    if (documentId && !props.onSuccess) {
      showSkillCreatedToast(documentId);
    }
  };

  const handleContinueInSplit = async () => {
    if (isCreating()) return;
    setErrorMessage('');

    const documentId = await submitSkill();
    if (!documentId) return;

    openWithSplit(
      { type: 'skill', id: documentId },
      { referredFrom: 'launcher', preferNewSplit: true }
    );
  };

  const handleClose = () => {
    splitPanel.handle.close();
    props.onClose?.();
  };

  onMount(() => {
    const container = containerRef();
    if (container) {
      attachHotkeys(container);
    }
  });

  registerHotkey({
    hotkey: 'cmd+enter',
    scopeId: composeHotkeyScope,
    description: 'Create skill',
    keyDownHandler: () => {
      handleCreateSkill();
      return true;
    },
    runWithInputFocused: true,
  });

  const editorConfig = buildConfig('markdown')
    .withMentions()
    .withEmojis()
    .withActions()
    .withCode()
    .withMedia({ fileDrop: true })
    .withSelectionData()
    .withHistory()
    .onChange(setContent)
    .onEscape(() => {
      containerRef()?.focus();
      return true;
    });

  const editor = editorConfig.buildHandle().lexical;
  setBodyEditor(editor);
  const portalScope = (): PortalScope =>
    splitPanel.handle.isPopover() ? 'local' : 'block';

  return (
    <div
      class="portal-scope flex flex-col relative h-full max-h-full min-h-0 p-4 gap-4"
      tabIndex={-1}
      ref={setContainerRef}
    >
      <div class="flex items-center gap-1">
        <div class="flex-1 flex items-center">
          <Show when={splitPanel?.handle.isPopover()}>
            <Button
              onMouseDown={handleContinueInSplit}
              disabled={isCreating()}
              tabIndex={-1}
              tooltip="Continue editing in split"
              size="icon-sm"
            >
              <ArrowsOutIcon />
            </Button>
          </Show>
        </div>
        <Show when={splitPanel?.handle.isPopover()}>
          <Button
            onMouseDown={handleClose}
            tabIndex={-1}
            tooltip="Close"
            size="icon-sm"
          >
            <XIcon />
          </Button>
        </Show>
      </div>
      <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div class="shrink-0 flex gap-2 items-center px-2 mb-4">
          <ComposeSkillTitleEditor
            value={title}
            onChange={setTitle}
            disabled={isCreating}
            bodyEditor={bodyEditor}
            containerRef={containerRef}
            onUserInput={() => {
              if (errorMessage()) {
                setErrorMessage('');
              }
            }}
          />
        </div>

        <div class="overflow-auto scrollbar-hidden mb-6 min-h-24 grow px-2">
          <Scroll>
            <MarkdownShell
              config={editorConfig}
              initialValue={props.initialContent || undefined}
              placeholder={props.placeholder ?? 'Add instructions...'}
              portalScope={portalScope()}
            />
          </Scroll>
        </div>
      </div>

      <Show when={errorMessage()}>
        <div class="w-full border-b border-edge-muted" />
        <div class="p-2">
          <div class="text-sm text-failure-ink px-3 py-2">{errorMessage()}</div>
        </div>
      </Show>

      <div class="shrink-0 flex justify-end items-end gap-2">
        <Button
          onClick={handleCreateSkill}
          disabled={title().trim().length === 0 || isCreating()}
          variant={title().trim().length === 0 ? 'ghost' : 'accent'}
          depth={3}
          class="gap-3 rounded-lg border-0"
        >
          Create Skill
          <Hotkey shortcut="cmd+enter" theme="current" />
        </Button>
      </div>
    </div>
  );
}
