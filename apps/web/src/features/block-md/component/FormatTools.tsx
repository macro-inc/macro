import { markdownBlockErrorSignal } from '@block-md/signal/error';
import {
  INSERT_HORIZONTAL_RULE_COMMAND,
  NODE_TRANSFORM,
  type NodeTransformType,
  type SelectionData,
  TRY_INSERT_EQUATION_COMMAND,
  TRY_INSERT_LINK_COMMAND,
  UNLINK_COMMAND,
} from '@core/component/LexicalMarkdown/plugins/';
import { CREATE_DRAFT_COMMENT_COMMAND } from '@core/component/LexicalMarkdown/plugins/comments/commentPlugin';
import { editorFocusSignal } from '@core/component/LexicalMarkdown/utils';
import { ENABLE_MARKDOWN_COMMENTS } from '@core/constant/featureFlags';
import { useCanComment, useCanEdit } from '@core/signal/permissions';
import type { ElementName } from '@lexical-core';
import CaretRight from '@phosphor/caret-right.svg';
import ChatTeardrop from '@phosphor/chat-teardrop.svg';
import Check from '@phosphor/check-square.svg';
import TextCode from '@phosphor/code.svg';
import CodeBlock from '@phosphor/code-block.svg';
import ThreeDots from '@phosphor/dots-three.svg';
import MathIcon from '@phosphor/function.svg';
import Grid from '@phosphor/grid-four.svg';
import BrokenLinkIcon from '@phosphor/link-break.svg';
import LinkIcon from '@phosphor/link-simple.svg';
import ListBullets from '@phosphor/list-bullets.svg';
import ListChecks from '@phosphor/list-checks.svg';
import ListNumbers from '@phosphor/list-numbers.svg';
import Minus from '@phosphor/minus.svg';
import One from '@phosphor/number-one.svg';
import TextHighlight from '@phosphor/paint-roller.svg';
import PlusSquare from '@phosphor/plus-square.svg';
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
import { Button, Dropdown, Hotkey, SingleSelectCheck } from '@ui';
import { toast } from 'core/component/Toast/Toast';
import type { ValidHotkey } from 'core/hotkey/types';
import {
  COMMAND_PRIORITY_LOW,
  FOCUS_COMMAND,
  FORMAT_TEXT_COMMAND,
  type LexicalEditor,
  type TextFormatType,
} from 'lexical';
import {
  type Accessor,
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  type ParentProps,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  generatedAndWaitingSignal,
  isGeneratingSignal,
} from '../signal/generateSignal';
import { mdStore } from '../signal/markdownBlockData';
import { MediaSelector } from './MediaSelector';
import { TableInsert } from './TableInsert';

function VerticalBar() {
  return <div class="w-px mx-1 h-full bg-edge"></div>;
}

type DropdownItemProps = {
  label: string;
  icon: Component;
  show: boolean;
  themeClass?: string;
  before?: JSX.Element;
};

export const NodeMenuOptions: Record<ElementName, DropdownItemProps> = {
  paragraph: {
    label: 'Body',
    icon: TextT,
    show: false,
    themeClass: '',
  },
  heading1: {
    label: 'Heading 1',
    icon: TextH1,
    show: true,
    themeClass: 'text-[1.15em] font-bold',
  },
  heading2: {
    label: 'Heading 2',
    icon: TextH2,
    show: true,
    themeClass: 'text-[1.07em] font-bold',
  },
  heading3: {
    label: 'Heading 3',
    icon: TextH3,
    show: true,
    themeClass: 'text-[1.03em] font-bold',
  },
  quote: { label: 'Quote', icon: Quote, show: true, themeClass: 'italic' },
  code: { label: 'Code', icon: CodeBlock, show: true, themeClass: 'font-mono' },
  'custom-code': {
    label: 'Code',
    icon: CodeBlock,
    show: false,
    themeClass: 'font-mono',
  },
  'list-bullet': {
    label: 'Bullet List',
    icon: ListBullets,
    show: true,
    before: <div class="bg-ink size-1.5 rounded-full ml-1.5 mr-3" />,
  },
  'list-number': {
    label: 'Numbered List',
    icon: ListNumbers,
    show: true,
    before: <One class="size-4 mr-2" />,
  },
  'list-check': {
    label: 'Checklist',
    icon: ListChecks,
    show: true,
    before: <Check class="size-4 mr-2" />,
  },
  link: { label: 'Link', icon: LinkIcon, show: false, themeClass: '' },
} as const;

type InlineFormat =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'highlight'
  | 'code'
  | 'superscript'
  | 'subscript';

const InlineIcons: Record<
  InlineFormat,
  Component<JSX.SvgSVGAttributes<SVGSVGElement>>
> = {
  bold: TextBold,
  italic: TextItalic,
  underline: TextUnderline,
  strikethrough: TextStriketrough,
  highlight: TextHighlight,
  code: TextCode,
  superscript: TextSuper,
  subscript: TextSub,
} as const;

const InlineShortcuts: Partial<Record<InlineFormat, ValidHotkey>> = {
  bold: 'cmd+b',
  italic: 'cmd+i',
  underline: 'cmd+u',
  strikethrough: 'shift+cmd+x',
  highlight: 'shift+cmd+h',
  code: 'cmd+e',
} as const;

const InlineLabels: Record<InlineFormat, string> = {
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  strikethrough: 'Strikethrough',
  highlight: 'Highlight',
  code: 'Inline code',
  superscript: 'Superscript',
  subscript: 'Subscript',
} as const;

const isInlineFormatActive = (
  selection: SelectionData | undefined,
  format: InlineFormat
) => !!selection?.[format];

const hasActiveInlineFormat = (
  selection: SelectionData | undefined,
  formats: InlineFormat[]
) => formats.some((format) => isInlineFormatActive(selection, format));

const isElementFormatActive = (
  selection: SelectionData | undefined,
  format: ElementName
) => !!selection?.elementsInRange?.has(format);

const hasActiveElementFormat = (
  selection: SelectionData | undefined,
  formats: ElementName[]
) => formats.some((format) => isElementFormatActive(selection, format));

const InlineFormatButton = (props: {
  format: InlineFormat;
  selection: () => SelectionData | undefined;
  onClick: (e: MouseEvent) => void;
  buttonIsDisabled: Accessor<boolean>;
}) => {
  const icon = InlineIcons[props.format];
  const isActive = () => isInlineFormatActive(props.selection(), props.format);
  return (
    <Button
      label={InlineLabels[props.format]}
      shortcut={InlineShortcuts[props.format]}
      size="icon-sm"
      variant={isActive() ? 'active' : 'ghost'}
      class="rounded-md"
      depth={3}
      onClick={(e: MouseEvent | KeyboardEvent) =>
        props.onClick(e as MouseEvent)
      }
      disabled={props.buttonIsDisabled()}
    >
      <Dynamic component={icon} />
    </Button>
  );
};

const InlineFormatMenuItem = (props: {
  format: InlineFormat;
  selection: () => SelectionData | undefined;
  onClick: () => void;
  buttonIsDisabled: Accessor<boolean>;
}) => {
  const icon = InlineIcons[props.format];
  const isActive = () => isInlineFormatActive(props.selection(), props.format);
  return (
    <Dropdown.Item
      onSelect={props.onClick}
      disabled={props.buttonIsDisabled()}
      class={isActive() ? 'text-ink' : ''}
      role="menuitemradio"
      aria-checked={isActive()}
    >
      <Dynamic component={icon} class="size-4 shrink-0" />
      <span class="flex-1 truncate">{InlineLabels[props.format]}</span>
      <Show when={InlineShortcuts[props.format]}>
        {(shortcut) => (
          <Hotkey shortcut={shortcut()} class="text-ink-muted" showPlus />
        )}
      </Show>
      <SingleSelectCheck active={isActive()} />
    </Dropdown.Item>
  );
};

export const ElementFormatButton = (props: {
  format: ElementName;
  selection: () => SelectionData | undefined;
  onClick: (e: MouseEvent) => void;
  buttonIsDisabled: Accessor<boolean>;
}) => {
  const name = NodeMenuOptions[props.format]?.label || 'Body';
  const icon = NodeMenuOptions[props.format]?.icon;
  return (
    <Button
      tooltip={name}
      size="icon-sm"
      class="rounded-md"
      depth={3}
      variant={
        isElementFormatActive(props.selection(), props.format)
          ? 'active'
          : 'ghost'
      }
      onClick={(e: MouseEvent | KeyboardEvent) =>
        props.onClick(e as MouseEvent)
      }
      disabled={props.buttonIsDisabled()}
    >
      <Dynamic component={icon} />
    </Button>
  );
};

const ElementFormatMenuItem = (
  props: ParentProps<{
    format: ElementName;
    selection: () => SelectionData | undefined;
    onClick: () => void;
    useIcon?: boolean;
    useStyle?: boolean;
    buttonIsDisabled: Accessor<boolean>;
  }>
) => {
  const name = NodeMenuOptions[props.format]?.label || 'Text';
  const themeClass = NodeMenuOptions[props.format]?.themeClass || '';
  const before = NodeMenuOptions[props.format]?.before;
  const isActive = () => isElementFormatActive(props.selection(), props.format);
  const inner = () => {
    if (props.useStyle) {
      return (
        <span class={themeClass + ' flex items-center gap-0 justify-start'}>
          {before}
          {name}
        </span>
      );
    }
    return <span>{name}</span>;
  };
  const icon = () =>
    props.useIcon ? NodeMenuOptions[props.format]?.icon : undefined;
  return (
    <Dropdown.Item
      onSelect={props.onClick}
      disabled={props.buttonIsDisabled()}
      class={isActive() ? 'text-ink' : ''}
      role="menuitemradio"
      aria-checked={isActive()}
    >
      <Show when={icon()}>
        {(IconComp) => (
          <Dynamic
            component={
              IconComp() as Component<JSX.SvgSVGAttributes<SVGSVGElement>>
            }
            class="size-4 shrink-0"
          />
        )}
      </Show>
      <span class="flex-1 truncate">{inner()}</span>
      <SingleSelectCheck active={isActive()} />
    </Dropdown.Item>
  );
};

export function FormatTools(props: { withinPopup?: boolean }) {
  const mdData = mdStore.get;
  const editor = () => mdData.editor;
  const titleEditor = () => mdData.titleEditor;
  const selection = () => mdData.selection;
  const [editorError] = markdownBlockErrorSignal;

  const [editorHasFocus, setEditorHasFocus] = createSignal(false);
  const [, setTitleEditorHasFocus] = createSignal(false);

  const [moreOptionsOpen, setMoreOptionsOpen] = createSignal(false);

  const [lastFocusedEditor, setLastFocusedEditor] =
    createSignal<LexicalEditor>();

  const editAccess = useCanEdit();
  const canEdit = () => editAccess();

  const canComment = ENABLE_MARKDOWN_COMMENTS ? useCanComment() : () => false;

  const buttonIsDisabled = createMemo(() => {
    return !(
      canEdit() &&
      !isGeneratingSignal() &&
      !generatedAndWaitingSignal() &&
      editorError() === null
    );
  });
  const commentButtonIsDisabled = createMemo(() => {
    return !(
      canComment() &&
      !isGeneratingSignal() &&
      !generatedAndWaitingSignal() &&
      editorError() === null
    );
  });
  const cleanups: Array<() => void> = [];

  function handleLink() {
    const currentEditor = editor();
    if (currentEditor === undefined) return;
    if (selection()?.hasLinks) {
      currentEditor.dispatchCommand(UNLINK_COMMAND, undefined);
      setTimeout(() => {
        currentEditor.focus();
      });
      return;
    }
    currentEditor.dispatchCommand(TRY_INSERT_LINK_COMMAND, undefined);
  }

  function handleInsertEquation() {
    const currentEditor = editor();
    if (currentEditor === undefined) return;
    currentEditor.dispatchCommand(TRY_INSERT_EQUATION_COMMAND, undefined);
  }

  createEffect(() => {
    const editor_ = editor();
    if (editor_ !== undefined) {
      cleanups.push(editorFocusSignal(editor_, setEditorHasFocus));
      cleanups.push(
        editor_.registerCommand(
          FOCUS_COMMAND,
          () => {
            setLastFocusedEditor(editor_);
            return false;
          },
          COMMAND_PRIORITY_LOW
        )
      );
    }
    const titleEditor_ = titleEditor();
    if (titleEditor_ !== undefined) {
      cleanups.push(editorFocusSignal(titleEditor_, setTitleEditorHasFocus));
      cleanups.push(
        titleEditor_.registerCommand(
          FOCUS_COMMAND,
          () => {
            setLastFocusedEditor(titleEditor_);
            return false;
          },
          COMMAND_PRIORITY_LOW
        )
      );
    }
  });

  onCleanup(() => {
    cleanups.forEach((cleanup) => cleanup());
  });

  function inlineFormat(format: TextFormatType): void {
    if (
      editorHasFocus() ||
      lastFocusedEditor() === editor() ||
      props.withinPopup
    ) {
      editor()?.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    }
  }

  function nodeFormat(transform: NodeTransformType): void {
    if (
      editorHasFocus() ||
      lastFocusedEditor() === editor() ||
      props.withinPopup
    ) {
      const isActive = selection()?.elementsInRange?.has(transform);
      // If the node type is already active, transform to paragraph (normal text)
      const targetTransform = isActive ? 'paragraph' : transform;
      editor()?.dispatchCommand(NODE_TRANSFORM, targetTransform);
    }
  }

  const handleInsertComment = () => {
    const created = editor()?.dispatchCommand(
      CREATE_DRAFT_COMMENT_COMMAND,
      undefined
    );
    if (!created) {
      toast.failure('Please highlight text to comment.');
    }
  };
  const InlineFormats: InlineFormat[] = [
    'bold',
    'italic',
    'underline',
    'strikethrough',
    'highlight',
  ];

  const MainFormatOptions: ElementName[] = [
    'heading1',
    'heading2',
    'heading3',
    'paragraph',
    'code',
    'quote',
    'list-bullet',
    'list-number',
    'list-check',
  ];

  const FormatDropDown = (props: { buttonIsDisabled: Accessor<boolean> }) => {
    const [menuOpen, setMenuOpen] = createSignal(false);
    const isActive = () =>
      hasActiveInlineFormat(selection(), InlineFormats) ||
      hasActiveElementFormat(selection(), MainFormatOptions);
    return (
      <Dropdown open={menuOpen()} onOpenChange={setMenuOpen}>
        <Dropdown.Trigger
          variant={isActive() ? 'active' : 'ghost'}
          size="icon-sm"
          class="rounded-md"
          depth={3}
          tooltip={'Text Styles'}
          disabled={buttonIsDisabled()}
          tabIndex={-1}
        >
          <TextAA />
        </Dropdown.Trigger>
        <Dropdown.Content
          onCloseAutoFocus={() => {
            lastFocusedEditor()?.focus();
          }}
        >
          <Dropdown.Group>
            <div class="w-full flex gap-1 justify-center items-center">
              <For each={InlineFormats}>
                {(format) => (
                  <InlineFormatButton
                    format={format}
                    selection={selection}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      inlineFormat(format);
                      setMenuOpen(false);
                    }}
                    buttonIsDisabled={buttonIsDisabled}
                  />
                )}
              </For>
            </div>
          </Dropdown.Group>
          <Dropdown.Group>
            <For each={MainFormatOptions}>
              {(format) => (
                <ElementFormatMenuItem
                  format={format}
                  selection={selection}
                  onClick={() => {
                    nodeFormat(format);
                    setMenuOpen(false);
                  }}
                  useIcon={true}
                  buttonIsDisabled={props.buttonIsDisabled}
                />
              )}
            </For>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    );
  };

  const InlineFormatPopDown = (props: {
    formats: InlineFormat[];
    buttonIsDisabled: Accessor<boolean>;
  }) => {
    const [menuOpen, setMenuOpen] = createSignal(false);
    const isActive = () => hasActiveInlineFormat(selection(), props.formats);
    return (
      <Dropdown open={menuOpen()} onOpenChange={setMenuOpen}>
        <Dropdown.Trigger
          variant={isActive() ? 'active' : 'ghost'}
          size="icon-sm"
          class="rounded-md"
          depth={3}
          tooltip="Text Styles"
          disabled={props.buttonIsDisabled()}
          tabIndex={-1}
        >
          <TextAA />
        </Dropdown.Trigger>
        <Show when={!props.buttonIsDisabled()}>
          <Dropdown.Content
            onCloseAutoFocus={() => {
              lastFocusedEditor()?.focus();
            }}
          >
            <Dropdown.Group>
              <div class="w-full flex gap-1 justify-center items-center">
                <For each={props.formats}>
                  {(format) => (
                    <InlineFormatButton
                      format={format}
                      selection={selection}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        inlineFormat(format);
                        setMenuOpen(false);
                      }}
                      buttonIsDisabled={buttonIsDisabled}
                    />
                  )}
                </For>
              </div>
            </Dropdown.Group>
          </Dropdown.Content>
        </Show>
      </Dropdown>
    );
  };

  // Text formatting dropdown for more options
  const InlineFormatMenu = (props: {
    excludes?: InlineFormat[];
    icon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
    label?: string;
    buttonIsDisabled: Accessor<boolean>;
  }) => (
    <Dropdown>
      <Dropdown.Trigger
        variant={
          hasActiveInlineFormat(
            selection(),
            (Object.keys(InlineIcons) as InlineFormat[]).filter(
              (format) => !props.excludes?.includes(format)
            )
          )
            ? 'active'
            : 'ghost'
        }
        size="icon-sm"
        class="rounded-md"
        depth={3}
        tooltip={props.label ?? 'More Formats'}
        disabled={buttonIsDisabled()}
        tabIndex={-1}
      >
        <Dynamic component={props.icon ?? ThreeDots} />
      </Dropdown.Trigger>
      <Show when={!buttonIsDisabled()}>
        <Dropdown.Content
          onCloseAutoFocus={() => {
            lastFocusedEditor()?.focus();
          }}
        >
          <Dropdown.Group>
            <For each={Object.keys(InlineIcons)}>
              {(format) => (
                <Show when={!props.excludes?.includes(format as InlineFormat)}>
                  <InlineFormatMenuItem
                    format={format as InlineFormat}
                    selection={selection}
                    onClick={() => {
                      inlineFormat(format as InlineFormat);
                    }}
                    buttonIsDisabled={buttonIsDisabled}
                  />
                </Show>
              )}
            </For>
          </Dropdown.Group>
        </Dropdown.Content>
      </Show>
    </Dropdown>
  );

  const ElementFormatMenu = (props: {
    elements: ElementName[];
    icon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
    label?: string;
    buttonIsDisabled: Accessor<boolean>;
  }) => (
    <Dropdown>
      <Dropdown.Trigger
        variant={
          hasActiveElementFormat(selection(), props.elements)
            ? 'active'
            : 'ghost'
        }
        size="icon-sm"
        class="rounded-md"
        depth={3}
        tooltip={props.label ?? 'More Formats'}
        disabled={buttonIsDisabled()}
        tabIndex={-1}
      >
        <Dynamic component={props.icon ?? ThreeDots} />
      </Dropdown.Trigger>
      <Show when={!buttonIsDisabled()}>
        <Dropdown.Content
          onCloseAutoFocus={() => {
            lastFocusedEditor()?.focus();
          }}
        >
          <Dropdown.Group>
            <For each={props.elements}>
              {(format) => (
                <ElementFormatMenuItem
                  format={format}
                  selection={selection}
                  onClick={() => {
                    nodeFormat(format);
                  }}
                  useIcon={true}
                  buttonIsDisabled={buttonIsDisabled}
                />
              )}
            </For>
          </Dropdown.Group>
        </Dropdown.Content>
      </Show>
    </Dropdown>
  );

  const FullWithElementButtons: ElementName[] = [
    'heading1',
    'heading2',
    'heading3',
    'list-bullet',
    'list-number',
    'list-check',
    'code',
    'quote',
  ];

  if (props.withinPopup) {
    return (
      <div class="flex h-full gap-1 items-center">
        <Show when={canEdit()}>
          <ElementFormatButton
            format="paragraph"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              nodeFormat('paragraph');
            }}
            buttonIsDisabled={buttonIsDisabled}
            selection={selection}
          />
          <ElementFormatMenu
            elements={['heading1', 'heading2', 'heading3']}
            icon={TextH}
            label="Headings"
            buttonIsDisabled={buttonIsDisabled}
          />
          <ElementFormatMenu
            elements={['list-bullet', 'list-number', 'list-check']}
            icon={ListBullets}
            label="Lists"
            buttonIsDisabled={buttonIsDisabled}
          />
          <ElementFormatButton
            format="code"
            selection={selection}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              nodeFormat('code');
            }}
            buttonIsDisabled={buttonIsDisabled}
          />
          <ElementFormatButton
            format="quote"
            selection={selection}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              nodeFormat('quote');
            }}
            buttonIsDisabled={buttonIsDisabled}
          />
          <InlineFormatPopDown
            formats={[
              'bold',
              'italic',
              'underline',
              'strikethrough',
              'code',
              'highlight',
              'superscript',
              'subscript',
            ]}
            buttonIsDisabled={buttonIsDisabled}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            class="rounded-md"
            depth={3}
            onClick={handleLink}
            tooltip={selection()?.hasLinks ? 'Remove Link' : 'Insert Link'}
            disabled={buttonIsDisabled()}
          >
            <Dynamic
              component={selection()?.hasLinks ? BrokenLinkIcon : LinkIcon}
            />
          </Button>
        </Show>
        <Show when={ENABLE_MARKDOWN_COMMENTS && canComment()}>
          <Button
            variant="ghost"
            size="icon-sm"
            class="rounded-md"
            depth={3}
            tooltip="Comment"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleInsertComment();
            }}
            disabled={commentButtonIsDisabled()}
          >
            <ChatTeardrop />
          </Button>
        </Show>
      </div>
    );
  } else {
    return (
      <>
        <Show when={canEdit()}>
          {/* ------------ Full width breakpoint ----------- */}
          <div class="hidden @4xl:flex h-full flex-nowrap">
            <div class="flex h-full gap-1">
              <For each={FullWithElementButtons}>
                {(format) => (
                  <ElementFormatButton
                    format={format}
                    selection={selection}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      nodeFormat(format);
                    }}
                    buttonIsDisabled={buttonIsDisabled}
                  />
                )}
              </For>
              {/* <IconButton */}
              {/*   icon={TextSlash} */}
              {/*   theme="clear" */}
              {/*   tooltip={{ label: 'Clear Formatting' }} */}
              {/*   onClick={(e) => { */}
              {/*     e.preventDefault(); */}
              {/*     e.stopPropagation(); */}
              {/*     nodeFormat('paragraph'); */}
              {/*   }} */}
              {/* /> */}
            </div>
            <VerticalBar />
            <div class="flex h-full gap-1">
              <For each={['bold', 'italic', 'underline']}>
                {(format) => (
                  <InlineFormatButton
                    format={format as InlineFormat}
                    selection={selection}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      inlineFormat(format as InlineFormat);
                    }}
                    buttonIsDisabled={buttonIsDisabled}
                  />
                )}
              </For>
              <InlineFormatMenu
                excludes={['bold', 'italic', 'underline']}
                buttonIsDisabled={buttonIsDisabled}
              />
            </div>
          </div>

          {/* ------------ Medium width breakpoint ----------- */}
          <div class="hidden @xl:flex @4xl:hidden h-full">
            <div class="flex h-full gap-1">
              <ElementFormatMenu
                elements={['heading1', 'heading2', 'heading3']}
                icon={TextH}
                label="Headings"
                buttonIsDisabled={buttonIsDisabled}
              />
              <ElementFormatMenu
                elements={['list-bullet', 'list-number', 'list-check']}
                icon={ListBullets}
                label="Lists"
                buttonIsDisabled={buttonIsDisabled}
              />
              <ElementFormatButton
                format="code"
                selection={selection}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  nodeFormat('code');
                }}
                buttonIsDisabled={buttonIsDisabled}
              />
              {/* <IconButton */}
              {/*   icon={TextSlash} */}
              {/*   theme="clear" */}
              {/*   tooltip={{ label: 'Clear Formatting' }} */}
              {/*   onClick={(e) => { */}
              {/*     e.preventDefault(); */}
              {/*     e.stopPropagation(); */}
              {/*     nodeFormat('paragraph'); */}
              {/*   }} */}
              {/* /> */}
            </div>
            <VerticalBar />
            <InlineFormatPopDown
              formats={[
                'bold',
                'italic',
                'underline',
                'strikethrough',
                'code',
                'superscript',
                'subscript',
              ]}
              buttonIsDisabled={buttonIsDisabled}
            />
          </div>

          {/* ------------ Small/mobile breakpoint ----------- */}
          <div class="flex h-full @xl:hidden">
            <FormatDropDown buttonIsDisabled={buttonIsDisabled} />
          </div>
          <VerticalBar />

          {/* ------------ Visible at all breakpoints ----------- */}
          <div class="flex gap-1 h-full">
            <Button
              variant="ghost"
              size="icon-sm"
              class="rounded-md"
              depth={3}
              onClick={handleLink}
              tooltip={selection()?.hasLinks ? 'Remove Link' : 'Insert Link'}
              disabled={buttonIsDisabled()}
            >
              <Dynamic
                component={selection()?.hasLinks ? BrokenLinkIcon : LinkIcon}
              />
            </Button>
            <MediaSelector buttonIsDisabled={buttonIsDisabled} />
            <Show when={ENABLE_MARKDOWN_COMMENTS}>
              <Button
                variant="ghost"
                size="icon-sm"
                class="rounded-md"
                depth={3}
                tooltip="Comment"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleInsertComment();
                }}
                disabled={commentButtonIsDisabled()}
              >
                <ChatTeardrop />
              </Button>
            </Show>
            <VerticalBar />
            <Dropdown
              open={moreOptionsOpen()}
              onOpenChange={setMoreOptionsOpen}
            >
              <Dropdown.Trigger
                variant="ghost"
                size="icon-sm"
                class="rounded-md"
                depth={3}
                tooltip="More"
                disabled={buttonIsDisabled()}
                tabIndex={-1}
              >
                <PlusSquare />
              </Dropdown.Trigger>
              <Show when={!buttonIsDisabled()}>
                <Dropdown.Content
                  onCloseAutoFocus={() => {
                    lastFocusedEditor()?.focus();
                  }}
                >
                  <Dropdown.Group>
                    <Dropdown.Item
                      onSelect={() => {
                        setMoreOptionsOpen(false);
                        nodeFormat('quote');
                      }}
                      disabled={buttonIsDisabled()}
                    >
                      <Quote class="size-4 shrink-0" />
                      <span class="flex-1 truncate">Block Quote</span>
                    </Dropdown.Item>
                  </Dropdown.Group>
                  <Dropdown.Group>
                    <Dropdown.Item
                      onSelect={() => {
                        setMoreOptionsOpen(false);
                        editor()?.dispatchCommand(
                          INSERT_HORIZONTAL_RULE_COMMAND,
                          undefined
                        );
                      }}
                      disabled={buttonIsDisabled()}
                    >
                      <Minus class="size-4 shrink-0" />
                      <span class="flex-1 truncate">Divider</span>
                    </Dropdown.Item>
                    <Dropdown.Item
                      onSelect={() => {
                        setMoreOptionsOpen(false);
                        handleInsertEquation();
                      }}
                      disabled={buttonIsDisabled()}
                    >
                      <MathIcon class="size-4 shrink-0" />
                      <span class="flex-1 truncate">Equation</span>
                    </Dropdown.Item>
                    <Dropdown.Sub>
                      <Dropdown.SubTrigger disabled={buttonIsDisabled()}>
                        <Grid class="size-4 shrink-0" />
                        <span class="flex-1 truncate">Table</span>
                        <CaretRight class="size-3.5" />
                      </Dropdown.SubTrigger>
                      <Dropdown.SubContent>
                        <Dropdown.Group>
                          <TableInsert
                            onMenuClose={() => setMoreOptionsOpen(false)}
                          />
                        </Dropdown.Group>
                      </Dropdown.SubContent>
                    </Dropdown.Sub>
                  </Dropdown.Group>
                </Dropdown.Content>
              </Show>
            </Dropdown>
          </div>

          {/* spacer before the AI button */}
          <div class="w-4"></div>
        </Show>
        <Show when={ENABLE_MARKDOWN_COMMENTS && canComment() && !canEdit()}>
          <Button
            variant="ghost"
            size="icon-sm"
            class="rounded-md"
            depth={3}
            tooltip="Comment"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleInsertComment();
            }}
            disabled={commentButtonIsDisabled()}
          >
            <ChatTeardrop />
          </Button>
        </Show>
      </>
    );
  }
}

// function ActionItem(props: {
//   text: string;
//   icon?: Component<any>;
//   onClick: () => void;
//   onClickNoBubble?: boolean;
//   shortcut?: string;
//   disabled?: boolean;
// }) {
//   return (
//     <MenuItem
//       text={props.text}
//       icon={props.icon}
//       onClick={props.onClick}
//       disabled={props.disabled}
//     />
//   );
// }

// function ActionItemWithShortcut(props: {
//   text: string;
//   icon?: Component<any>;
//   onClick: () => void;
//   onClickNoBubble?: boolean;
//   shortcut?: string;
//   disabled?: boolean;
// }) {
//   return (
//     <MenuItem
//       text={props.text}
//       icon={props.icon}
//       onClick={props.onClick}
//       disabled={props.disabled}
//     />
//   );
// }
