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
import CaretDown from '@icon/system/regular/caret-down.svg';
import TextCode from '@icon/system/regular/code.svg';
import CodeBlock from '@icon/system/regular/code-block.svg';
import DotsThreeLarge from '@icon/system/regular/dots-three.svg';
import BrokenLinkIcon from '@icon/system/regular/link-break.svg';
import LinkIcon from '@icon/system/regular/link-simple.svg';
import ListBullets from '@icon/system/regular/list-bullets.svg';
import ListChecks from '@icon/system/regular/list-checks.svg';
import ListNumbers from '@icon/system/regular/list-numbers.svg';
import TextHighlight from '@icon/system/regular/paint-roller.svg';
import Quote from '@icon/system/regular/quotes.svg';
import TextBold from '@icon/system/regular/text-b.svg';
import TextH1 from '@icon/system/regular/text-h-one.svg';
import TextH3 from '@icon/system/regular/text-h-three.svg';
import TextH2 from '@icon/system/regular/text-h-two.svg';
import TextItalic from '@icon/system/regular/text-italic.svg';
import TextStriketrough from '@icon/system/regular/text-strikethrough.svg';
import TextSub from '@icon/system/regular/text-subscript.svg';
import TextSuper from '@icon/system/regular/text-superscript.svg';
import TextT from '@icon/system/regular/text-t.svg';
import TextUnderline from '@icon/system/regular/text-underline.svg';
import { Button, Dropdown, SingleSelectCheck, Toolbar } from '@ui';
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
import type { FormatMenuHost } from '../../editing/overlay-hosts/format';
import { createLexicalFormatMenuHost } from '../../editing/overlay-hosts/lexical-format';
import type { NodeTransformType } from '../../plugins/node-transform/nodeTransformPlugin';

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

export interface FloatingFormatMenuOptions {
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
}

export function FloatingFormatMenu(props: FloatingFormatMenuOptions) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  if (!lexicalWrapper) {
    console.error('FloatingFormatMenu requires LexicalWrapperContext!');
    return '';
  }

  // On mobile the native selection toolbar takes this menu's place.
  if (isMobile()) return '';

  return (
    <HostedFloatingFormatMenu
      host={createLexicalFormatMenuHost(lexicalWrapper)}
      options={props}
    />
  );
}

export function HostedFloatingFormatMenu(props: {
  host: FormatMenuHost;
  options?: FloatingFormatMenuOptions;
}) {
  if (isMobile()) return '';
  const host = props.host;
  const options = props.options ?? {};
  const selection = host.selection;

  const [menuOpen, setMenuOpen] = createMenuOpenSignal(
    MENU_ID,
    MenuPriority.Normal
  );
  const [domSelection, setDOMSelection] = createSignal<Selection | undefined>(
    undefined,
    { equals: false }
  );

  host.registerPopup({ visible: setMenuOpen, selection: setDOMSelection });

  // Lag the open state so the menu doesn't flash while a selection is being
  // dragged out (same delay as the markdown block popup).
  const showMenu = debouncedDependent(menuOpen, 100);

  const [menuRef, setMenuRef] = createSignal<HTMLDivElement>();

  host.registerListeners({
    focusOut(relatedTarget) {
      if (relatedTarget instanceof Node && menuRef()?.contains(relatedTarget)) {
        return;
      }
      setMenuOpen(false);
    },
    transform() {
      setMenuOpen(false);
      return false;
    },
    escape() {
      if (!menuOpen()) return false;
      setMenuOpen(false);
      return true;
    },
  });

  onCleanup(() => {
    setMenuOpen(false);
  });

  const refocusEditor = () => {
    host.focus();
  };

  const inlineFormat = (format: InlineFormat) => {
    host.formatText(format);
  };

  const nodeFormat = (transform: NodeTransformType) => {
    const isActive = selection()?.elementsInRange?.has(transform);
    // If the node type is already active, transform back to paragraph.
    host.formatBlock(isActive ? 'paragraph' : transform);
  };

  const handleLink = (e?: MouseEvent | KeyboardEvent) => {
    e?.preventDefault();
    e?.stopPropagation();

    if (selection()?.hasLinks) {
      host.unlink();
      setTimeout(() => {
        host.focus();
      });
      return;
    }
    host.requestLink();
  };

  const moreInlineOptions = () =>
    options.extendedInlineFormats
      ? [...MoreInlineOptions, ...ExtendedInlineOptions]
      : MoreInlineOptions;

  const InlineButton = (buttonProps: { item: InlineOption }) => (
    <Button
      aria-label={buttonProps.item.label}
      tooltip={{
        content: buttonProps.item.label,
        shortcut: buttonProps.item.shortcut,
      }}
      size="icon-sm"
      variant={selection()?.[buttonProps.item.format] ? 'primary' : 'ghost'}
      onPointerDown={(e: PointerEvent) => e.preventDefault()}
      onClick={(e: MouseEvent | KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
        inlineFormat(buttonProps.item.format);
      }}
    >
      <Dynamic component={buttonProps.item.icon} class="size-4" />
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
          tooltip="More formatting"
          tabIndex={-1}
        >
          <DotsThreeLarge class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
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
          class="gap-1"
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
    <Show when={showMenu() && host.isInteractable() && domSelection()}>
      <ScopedPortal scope={options.portalScope}>
        <div
          ref={setMenuRef}
          class="fixed top-0 left-0 z-action-menu w-fit"
          use:floatWithSelection={{
            selection: domSelection(),
            reactiveOnContainer: host.root(),
            useBlockBoundary: true,
            moveWithSelection: true,
            clipToVisible: true,
          }}
        >
          <Toolbar>
            <For each={PrimaryInlineOptions}>
              {(item) => <InlineButton item={item} />}
            </For>
            <Show when={options.showLinkButton ?? true}>
              <Button
                variant="ghost"
                size="icon-sm"
                onPointerDown={(e: PointerEvent) => e.preventDefault()}
                onClick={handleLink}
                tooltip={selection()?.hasLinks ? 'Remove Link' : 'Insert Link'}
              >
                <Dynamic
                  component={selection()?.hasLinks ? BrokenLinkIcon : LinkIcon}
                  class="size-4"
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
