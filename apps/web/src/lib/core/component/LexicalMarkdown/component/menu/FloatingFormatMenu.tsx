/**
 * @file A floating format toolbar that appears over the current text
 * selection. Offers the same markdown controls as the markdown/tasks block
 * selection popup (block styles, inline styles, links) without the
 * block-specific actions, so lightweight editors like the email composer can
 * opt in via MarkdownTextarea.
 */
import { type PortalScope, ScopedPortal } from '@core/component/ScopedPortal';
import { isMobile } from '@core/mobile/isMobile';
import { debouncedDependent } from '@core/util/debounce';
import DotsThreeLarge from '@icon/dots-three-large.svg';
import CaretDown from '@phosphor/caret-down.svg';
import TextCode from '@phosphor/code.svg';
import CodeBlock from '@phosphor/code-block.svg';
import BrokenLinkIcon from '@phosphor/link-break.svg';
import LinkIcon from '@phosphor/link-simple.svg';
import ListBullets from '@phosphor/list-bullets.svg';
import ListChecks from '@phosphor/list-checks.svg';
import ListNumbers from '@phosphor/list-numbers.svg';
import TextHighlight from '@phosphor/paint-roller.svg';
import Quote from '@phosphor/quotes.svg';
import TextBold from '@phosphor/text-b.svg';
import TextH1 from '@phosphor/text-h-one.svg';
import TextH3 from '@phosphor/text-h-three.svg';
import TextH2 from '@phosphor/text-h-two.svg';
import TextItalic from '@phosphor/text-italic.svg';
import TextStriketrough from '@phosphor/text-strikethrough.svg';
import TextSub from '@phosphor/text-subscript.svg';
import TextSuper from '@phosphor/text-superscript.svg';
import TextT from '@phosphor/text-t.svg';
import TextUnderline from '@phosphor/text-underline.svg';
import { Button, Dropdown, SingleSelectCheck, Toolbar } from '@ui';
import {
  COMMAND_PRIORITY_HIGH,
  FORMAT_TEXT_COMMAND,
  KEY_ESCAPE_COMMAND,
} from 'lexical';
import {
  type Component,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
  useContext,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  createMenuOpenSignal,
  MenuPriority,
} from '../../context/FloatingMenuContext';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { floatWithSelection } from '../../directive/floatWithSelection';
import {
  autoRegister,
  type EnhancedSelection,
  NODE_TRANSFORM,
  type NodeTransformType,
  popupPlugin,
  registerRootEventListener,
  type SelectionData,
  TRY_INSERT_LINK_COMMAND,
  UNLINK_COMMAND,
} from '../../plugins';

false && floatWithSelection;

const MENU_ID = 'floating-format-menu';

type SvgIcon = Component<JSX.SvgSVGAttributes<SVGSVGElement>>;

type InlineFormat =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'highlight'
  | 'code'
  | 'superscript'
  | 'subscript';

type InlineOption = {
  format: InlineFormat;
  icon: SvgIcon;
  label: string;
  shortcut?: string;
};

// Bold/italic always get their own buttons (cmd+b/i via Lexical rich text).
const PrimaryInlineOptions: InlineOption[] = [
  { format: 'bold', icon: TextBold, label: 'Bold', shortcut: 'cmd+b' },
  { format: 'italic', icon: TextItalic, label: 'Italic', shortcut: 'cmd+i' },
];

// Markdown-safe inline formats, shown in the "..." menu. Shortcuts mirror the
// DefaultShortcuts registered by these editors' keyboardShortcutsPlugin.
const MoreInlineOptions: InlineOption[] = [
  {
    format: 'strikethrough',
    icon: TextStriketrough,
    label: 'Strikethrough',
    shortcut: 'shift+cmd+x',
  },
  { format: 'code', icon: TextCode, label: 'Inline code', shortcut: 'cmd+e' },
  {
    format: 'highlight',
    icon: TextHighlight,
    label: 'Highlight',
    shortcut: 'shift+cmd+h',
  },
];

// Not representable in Markdown; appended to the "..." menu only when the host
// opts in via `extendedInlineFormats` (e.g. non-Markdown-backed editors).
const ExtendedInlineOptions: InlineOption[] = [
  {
    format: 'underline',
    icon: TextUnderline,
    label: 'Underline',
    shortcut: 'cmd+u',
  },
  { format: 'superscript', icon: TextSuper, label: 'Superscript' },
  { format: 'subscript', icon: TextSub, label: 'Subscript' },
];

type ElementOption = {
  format: NodeTransformType;
  icon: SvgIcon;
  label: string;
};

const HeadingOptions: ElementOption[] = [
  { format: 'heading1', icon: TextH1, label: 'Heading 1' },
  { format: 'heading2', icon: TextH2, label: 'Heading 2' },
  { format: 'heading3', icon: TextH3, label: 'Heading 3' },
];

const ListOptions: ElementOption[] = [
  { format: 'list-bullet', icon: ListBullets, label: 'Bullet List' },
  { format: 'list-number', icon: ListNumbers, label: 'Numbered List' },
  { format: 'list-check', icon: ListChecks, label: 'Checklist' },
];

// The full block-style list, surfaced through the single "Text" dropdown.
const BlockOptions: ElementOption[] = [
  { format: 'paragraph', icon: TextT, label: 'Body' },
  ...HeadingOptions,
  ...ListOptions,
  { format: 'code', icon: CodeBlock, label: 'Code' },
  { format: 'quote', icon: Quote, label: 'Quote' },
];

export function FloatingFormatMenu(props: {
  portalScope?: PortalScope;
  /**
   * The link button dispatches commands handled by the links plugin, which is
   * registered by FloatingLinkMenu. Pass false when no FloatingLinkMenu is
   * mounted alongside this menu. Defaults to true.
   */
  showLinkButton?: boolean;
  /**
   * Include underline / super / subscript in the "..." menu. These can't be
   * represented in Markdown, so leave off for Markdown-backed editors.
   */
  extendedInlineFormats?: boolean;
}) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  if (!lexicalWrapper) {
    console.error('FloatingFormatMenu requires LexicalWrapperContext!');
    return '';
  }

  // On mobile the native selection toolbar takes this menu's place.
  if (isMobile()) return '';

  const { editor, plugins } = lexicalWrapper;
  const selection = (): SelectionData | undefined => lexicalWrapper.selection;

  const [menuOpen, setMenuOpen] = createMenuOpenSignal(
    MENU_ID,
    MenuPriority.Normal
  );
  const [selectionInfo, setSelectionInfo] =
    createSignal<EnhancedSelection | null>(null, { equals: () => false });

  plugins.use(
    popupPlugin({
      setIsPopupVisible: setMenuOpen,
      setSelection: setSelectionInfo,
    })
  );

  // Lag the open state so the menu doesn't flash while a selection is being
  // dragged out (same delay as the markdown block popup).
  const showMenu = debouncedDependent(menuOpen, 100);

  const [menuRef, setMenuRef] = createSignal<HTMLDivElement>();

  autoRegister(
    registerRootEventListener(editor, 'focusout', ({ relatedTarget }) => {
      if (relatedTarget instanceof Node && menuRef()?.contains(relatedTarget)) {
        return;
      }
      setMenuOpen(false);
    }),
    editor.registerCommand(
      NODE_TRANSFORM,
      () => {
        setMenuOpen(false);
        return false;
      },
      COMMAND_PRIORITY_HIGH
    ),
    editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        if (!menuOpen()) return false;
        setMenuOpen(false);
        return true;
      },
      COMMAND_PRIORITY_HIGH
    )
  );

  onCleanup(() => {
    setMenuOpen(false);
  });

  const refocusEditor = () => {
    editor.focus();
  };

  const inlineFormat = (format: InlineFormat) => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
  };

  const nodeFormat = (transform: NodeTransformType) => {
    const isActive = selection()?.elementsInRange?.has(transform);
    // If the node type is already active, transform back to paragraph.
    editor.dispatchCommand(NODE_TRANSFORM, isActive ? 'paragraph' : transform);
  };

  const handleLink = (e?: MouseEvent | KeyboardEvent) => {
    e?.preventDefault();
    e?.stopPropagation();

    if (selection()?.hasLinks) {
      editor.dispatchCommand(UNLINK_COMMAND, undefined);
      setTimeout(() => {
        editor.focus();
      });
      return;
    }
    editor.dispatchCommand(TRY_INSERT_LINK_COMMAND, undefined);
  };

  const domSelection = () => {
    const info = selectionInfo();
    return info?.type === 'range' ? info.domSelection : undefined;
  };

  const moreInlineOptions = () =>
    props.extendedInlineFormats
      ? [...MoreInlineOptions, ...ExtendedInlineOptions]
      : MoreInlineOptions;

  const InlineButton = (buttonProps: { item: InlineOption }) => (
    <Button
      label={buttonProps.item.label}
      shortcut={buttonProps.item.shortcut}
      size="icon-sm"
      class="rounded-md"
      depth={3}
      variant={selection()?.[buttonProps.item.format] ? 'accent' : 'ghost'}
      onPointerDown={(e: PointerEvent) => e.preventDefault()}
      onClick={(e: MouseEvent | KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
        inlineFormat(buttonProps.item.format);
      }}
    >
      <Dynamic component={buttonProps.item.icon} />
    </Button>
  );

  // The remaining inline formats, opened as a horizontal row of buttons.
  const MoreInlineDropdown = () => {
    const [open, setOpen] = createSignal(false);
    return (
      <Dropdown open={open()} onOpenChange={setOpen}>
        <Dropdown.Trigger
          variant="ghost"
          size="icon-sm"
          class="rounded-md"
          depth={3}
          tooltip="More formatting"
          tabIndex={-1}
        >
          <DotsThreeLarge />
        </Dropdown.Trigger>
        <Dropdown.Content onCloseAutoFocus={refocusEditor}>
          <Dropdown.Group>
            <div class="flex items-center gap-1">
              <For each={moreInlineOptions()}>
                {(item) => <InlineButton item={item} />}
              </For>
            </div>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    );
  };

  // A single "Text" trigger that reflects the selected block and opens the
  // block-style menu.
  const TextBlockDropdown = () => {
    const [open, setOpen] = createSignal(false);
    const currentLabel = () => {
      const active = BlockOptions.filter((option) =>
        selection()?.elementsInRange?.has(option.format)
      );
      return active.length === 1 ? active[0].label : 'Text';
    };
    return (
      <Dropdown open={open()} onOpenChange={setOpen}>
        <Dropdown.Trigger
          variant="ghost"
          size="sm"
          class="gap-1 rounded-md"
          depth={3}
          tooltip="Text style"
          tabIndex={-1}
        >
          {currentLabel()}
          <CaretDown class="size-3" />
        </Dropdown.Trigger>
        <Dropdown.Content class="text-xs" onCloseAutoFocus={refocusEditor}>
          <Dropdown.Group>
            <For each={BlockOptions}>
              {(item) => {
                const isActive = () =>
                  !!selection()?.elementsInRange?.has(item.format);
                return (
                  <Dropdown.Item
                    onSelect={() => {
                      nodeFormat(item.format);
                      setOpen(false);
                    }}
                    class={isActive() ? 'text-ink' : ''}
                    role="menuitemradio"
                    aria-checked={isActive()}
                  >
                    <Dynamic component={item.icon} class="size-4 shrink-0" />
                    <span class="flex-1 truncate">{item.label}</span>
                    <SingleSelectCheck active={isActive()} />
                  </Dropdown.Item>
                );
              }}
            </For>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    );
  };

  return (
    <Show
      when={showMenu() && lexicalWrapper.isInteractable() && domSelection()}
    >
      <ScopedPortal scope={props.portalScope}>
        <div
          ref={setMenuRef}
          class="fixed top-0 left-0 z-highlight-menu w-fit"
          use:floatWithSelection={{
            selection: domSelection(),
            reactiveOnContainer: editor.getRootElement(),
            useBlockBoundary: true,
            moveWithSelection: true,
          }}
        >
          <Toolbar>
            <For each={PrimaryInlineOptions}>
              {(item) => <InlineButton item={item} />}
            </For>
            <Show when={props.showLinkButton ?? true}>
              <Button
                variant="ghost"
                size="icon-sm"
                class="rounded-md"
                depth={3}
                onPointerDown={(e: PointerEvent) => e.preventDefault()}
                onClick={handleLink}
                tooltip={selection()?.hasLinks ? 'Remove Link' : 'Insert Link'}
              >
                <Dynamic
                  component={selection()?.hasLinks ? BrokenLinkIcon : LinkIcon}
                />
              </Button>
            </Show>
            <MoreInlineDropdown />
            <Toolbar.Divider />
            <TextBlockDropdown />
          </Toolbar>
        </div>
      </ScopedPortal>
    </Show>
  );
}
