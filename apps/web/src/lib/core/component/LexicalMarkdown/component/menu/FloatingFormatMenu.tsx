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
import TextCode from '@phosphor/code.svg';
import CodeBlock from '@phosphor/code-block.svg';
import BrokenLinkIcon from '@phosphor/link-break.svg';
import LinkIcon from '@phosphor/link-simple.svg';
import ListBullets from '@phosphor/list-bullets.svg';
import ListChecks from '@phosphor/list-checks.svg';
import ListNumbers from '@phosphor/list-numbers.svg';
import TextHighlight from '@phosphor/paint-roller.svg';
import Quote from '@phosphor/quotes.svg';
import TextAA from '@phosphor/text-aa.svg';
import TextBold from '@phosphor/text-b.svg';
import TextH from '@phosphor/text-h.svg';
import TextH1 from '@phosphor/text-h-one.svg';
import TextH3 from '@phosphor/text-h-three.svg';
import TextH2 from '@phosphor/text-h-two.svg';
import TextItalic from '@phosphor/text-italic.svg';
import TextStriketrough from '@phosphor/text-strikethrough.svg';
import TextSub from '@phosphor/text-subscript.svg';
import TextSuper from '@phosphor/text-superscript.svg';
import TextT from '@phosphor/text-t.svg';
import TextUnderline from '@phosphor/text-underline.svg';
import { Button, Dropdown, Layer, SingleSelectCheck } from '@ui';
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

// Only cmd+b/i/u are registered by Lexical's rich text in MarkdownTextarea,
// so only those shortcuts are advertised here.
const InlineFormatOptions: Array<{
  format: InlineFormat;
  icon: SvgIcon;
  label: string;
  shortcut?: string;
}> = [
  { format: 'bold', icon: TextBold, label: 'Bold', shortcut: 'cmd+b' },
  { format: 'italic', icon: TextItalic, label: 'Italic', shortcut: 'cmd+i' },
  {
    format: 'underline',
    icon: TextUnderline,
    label: 'Underline',
    shortcut: 'cmd+u',
  },
  { format: 'strikethrough', icon: TextStriketrough, label: 'Strikethrough' },
  { format: 'code', icon: TextCode, label: 'Inline code' },
  { format: 'highlight', icon: TextHighlight, label: 'Highlight' },
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

export function FloatingFormatMenu(props: {
  portalScope?: PortalScope;
  /**
   * The link button dispatches commands handled by the links plugin, which is
   * registered by FloatingLinkMenu. Pass false when no FloatingLinkMenu is
   * mounted alongside this menu. Defaults to true.
   */
  showLinkButton?: boolean;
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

  return (
    <Show
      when={showMenu() && lexicalWrapper.isInteractable() && domSelection()}
    >
      <ScopedPortal scope={props.portalScope}>
        <Layer depth={2}>
          <div
            ref={setMenuRef}
            class="fixed top-0 left-0 z-highlight-menu border border-edge bg-surface shadow-xl rounded-lg p-1 flex flex-row items-center gap-1"
            use:floatWithSelection={{
              selection: domSelection(),
              reactiveOnContainer: editor.getRootElement(),
              useBlockBoundary: true,
              moveWithSelection: true,
            }}
          >
            <ElementFormatButton
              format="paragraph"
              icon={TextT}
              label="Body"
              selection={selection}
              onFormat={nodeFormat}
            />
            <ElementFormatMenu
              items={HeadingOptions}
              icon={TextH}
              label="Headings"
              selection={selection}
              onFormat={nodeFormat}
              onCloseAutoFocus={refocusEditor}
            />
            <ElementFormatMenu
              items={ListOptions}
              icon={ListBullets}
              label="Lists"
              selection={selection}
              onFormat={nodeFormat}
              onCloseAutoFocus={refocusEditor}
            />
            <ElementFormatButton
              format="code"
              icon={CodeBlock}
              label="Code"
              selection={selection}
              onFormat={nodeFormat}
            />
            <ElementFormatButton
              format="quote"
              icon={Quote}
              label="Quote"
              selection={selection}
              onFormat={nodeFormat}
            />
            <InlineFormatMenu
              selection={selection}
              onFormat={inlineFormat}
              onCloseAutoFocus={refocusEditor}
            />
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
          </div>
        </Layer>
      </ScopedPortal>
    </Show>
  );
}

function ElementFormatButton(props: {
  format: NodeTransformType;
  icon: SvgIcon;
  label: string;
  selection: () => SelectionData | undefined;
  onFormat: (format: NodeTransformType) => void;
}) {
  const isActive = () =>
    !!props.selection()?.elementsInRange?.has(props.format);
  return (
    <Button
      tooltip={props.label}
      size="icon-sm"
      class="rounded-md"
      depth={3}
      variant={isActive() ? 'accent' : 'ghost'}
      onPointerDown={(e: PointerEvent) => e.preventDefault()}
      onClick={(e: MouseEvent | KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
        props.onFormat(props.format);
      }}
    >
      <Dynamic component={props.icon} />
    </Button>
  );
}

function ElementFormatMenu(props: {
  items: ElementOption[];
  icon: SvgIcon;
  label: string;
  selection: () => SelectionData | undefined;
  onFormat: (format: NodeTransformType) => void;
  onCloseAutoFocus: () => void;
}) {
  const isAnyActive = () =>
    props.items.some((item) =>
      props.selection()?.elementsInRange?.has(item.format)
    );
  return (
    <Dropdown>
      <Dropdown.Trigger
        variant={isAnyActive() ? 'accent' : 'ghost'}
        size="icon-sm"
        class="rounded-md"
        depth={3}
        tooltip={props.label}
        tabIndex={-1}
      >
        <Dynamic component={props.icon} />
      </Dropdown.Trigger>
      <Dropdown.Content onCloseAutoFocus={props.onCloseAutoFocus}>
        <Dropdown.Group>
          <For each={props.items}>
            {(item) => {
              const isActive = () =>
                !!props.selection()?.elementsInRange?.has(item.format);
              return (
                <Dropdown.Item
                  onSelect={() => props.onFormat(item.format)}
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
}

function InlineFormatMenu(props: {
  selection: () => SelectionData | undefined;
  onFormat: (format: InlineFormat) => void;
  onCloseAutoFocus: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  const isAnyActive = () =>
    InlineFormatOptions.some((item) => props.selection()?.[item.format]);
  return (
    <Dropdown open={open()} onOpenChange={setOpen}>
      <Dropdown.Trigger
        variant={isAnyActive() ? 'accent' : 'ghost'}
        size="icon-sm"
        class="rounded-md"
        depth={3}
        tooltip="Text Styles"
        tabIndex={-1}
      >
        <TextAA />
      </Dropdown.Trigger>
      <Dropdown.Content onCloseAutoFocus={props.onCloseAutoFocus}>
        <Dropdown.Group>
          <div class="w-full flex gap-1 justify-center items-center">
            <For each={InlineFormatOptions}>
              {(item) => (
                <Button
                  label={item.label}
                  shortcut={item.shortcut}
                  size="icon-sm"
                  variant={
                    props.selection()?.[item.format] ? 'accent' : 'ghost'
                  }
                  class="rounded-md"
                  depth={3}
                  onClick={(e: MouseEvent | KeyboardEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                    props.onFormat(item.format);
                    setOpen(false);
                  }}
                >
                  <Dynamic component={item.icon} />
                </Button>
              )}
            </For>
          </div>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
