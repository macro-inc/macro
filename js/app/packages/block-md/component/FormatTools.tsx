import { markdownBlockErrorSignal } from '@block-md/signal/error';
import { BasicHotkey } from '@core/component/Hotkey';
import { IconButton } from '@core/component/IconButton';
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
import {
  DropdownMenuContent,
  MenuItem,
  SubTrigger,
} from '@core/component/Menu';
import { ENABLE_MARKDOWN_COMMENTS } from '@core/constant/featureFlags';
import { useCanComment, useCanEdit } from '@core/signal/permissions';
import ThreeDots from '@icon/bold/dots-three-bold.svg';
import TextBold from '@icon/bold/text-b-bold.svg';
import ChatTeardrop from '@icon/regular/chat-teardrop.svg';
import Check from '@icon/regular/check-square.svg';
import TextCode from '@icon/regular/code.svg';
import CodeBlock from '@icon/regular/code-block.svg';
import MathIcon from '@icon/regular/function.svg';
import Grid from '@icon/regular/grid-four.svg';
import BrokenLinkIcon from '@icon/regular/link-break.svg';
import LinkIcon from '@icon/regular/link-simple.svg';
import ListBullets from '@icon/regular/list-bullets.svg';
import ListChecks from '@icon/regular/list-checks.svg';
import ListNumbers from '@icon/regular/list-numbers.svg';
import Minus from '@icon/regular/minus.svg';
import One from '@icon/regular/number-one.svg';
import TextHighlight from '@icon/regular/paint-roller.svg';
import PlusSquare from '@icon/regular/plus-square.svg';
import Quote from '@icon/regular/quotes.svg';
import TextAA from '@icon/regular/text-aa.svg';
import TextH from '@icon/regular/text-h.svg';
import TextH1 from '@icon/regular/text-h-one.svg';
import TextH3 from '@icon/regular/text-h-three.svg';
import TextH2 from '@icon/regular/text-h-two.svg';
import TextItalic from '@icon/regular/text-italic.svg';
import TextStriketrough from '@icon/regular/text-strikethrough.svg';
import TextSub from '@icon/regular/text-subscript.svg';
import TextSuper from '@icon/regular/text-superscript.svg';
import TextT from '@icon/regular/text-t.svg';
import TextUnderline from '@icon/regular/text-underline.svg';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import type { ElementName } from '@lexical-core';
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

function HorizontalBar() {
  return <div class="w-full h-px bg-edge my-1"></div>;
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

const InlineFormatButton = (props: {
  format: InlineFormat;
  selection: () => SelectionData | undefined;
  onClick: (e: MouseEvent) => void;
  buttonIsDisabled: Accessor<boolean>;
}) => {
  const icon = InlineIcons[props.format];
  return (
    <IconButton
      tooltip={{ label: props.format, shortcut: InlineShortcuts[props.format] }}
      icon={icon}
      theme={props.selection()?.[props.format] ? 'accent' : 'clear'}
      onClick={(e: MouseEvent | KeyboardEvent) =>
        props.onClick(e as MouseEvent)
      }
      disabled={props.buttonIsDisabled()}
    />
  );
};

const InlineFormatMenuItem = (props: {
  format: InlineFormat;
  selection: () => SelectionData | undefined;
  onClick: () => void;
  buttonIsDisabled: Accessor<boolean>;
}) => {
  const icon = InlineIcons[props.format];
  const inner = () => (
    <div class="flex justify-between">
      <span class="capitalize">{props.format}</span>
      <Show when={InlineShortcuts[props.format]}>
        {(shortcut) => {
          return <BasicHotkey shortcut={shortcut()} />;
        }}
      </Show>
    </div>
  );

  return (
    <MenuItem
      text={inner()}
      icon={icon}
      onClick={props.onClick}
      disabled={props.buttonIsDisabled()}
    />
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
    <IconButton
      tooltip={{ label: name }}
      icon={icon}
      theme={
        props.selection()?.elementsInRange?.has(props.format)
          ? 'accent'
          : 'clear'
      }
      onClick={(e: MouseEvent | KeyboardEvent) =>
        props.onClick(e as MouseEvent)
      }
      disabled={props.buttonIsDisabled()}
    />
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
  return (
    <MenuItem
      icon={props.useIcon ? NodeMenuOptions[props.format]?.icon : undefined}
      text={inner()}
      onClick={props.onClick}
      disabled={props.buttonIsDisabled()}
    />
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
    const _editor = editor();
    if (_editor === undefined) return;
    if (selection()?.hasLinks) {
      _editor.dispatchCommand(UNLINK_COMMAND, undefined);
      setTimeout(() => {
        _editor.focus();
      });
      return;
    }
    _editor.dispatchCommand(TRY_INSERT_LINK_COMMAND, undefined);
  }

  function handleInsertEquation() {
    const _editor = editor();
    if (_editor === undefined) return;
    _editor.dispatchCommand(TRY_INSERT_EQUATION_COMMAND, undefined);
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
    'list-bullet',
    'list-number',
    'list-check',
  ];

  const FormatDropDown = (props: { buttonIsDisabled: Accessor<boolean> }) => {
    const [menuOpen, setMenuOpen] = createSignal(false);
    // TODO bring up to menu best practives, ie. fully focusable menu items, etc.
    return (
      <DropdownMenu open={menuOpen()} onOpenChange={setMenuOpen}>
        <DropdownMenu.Trigger>
          <IconButton
            icon={TextAA}
            theme="clear"
            tooltip={{ label: 'Text Styles' }}
            showChevron
            disabled={buttonIsDisabled()}
            tabIndex={-1}
          />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenuContent
            class="w-54"
            onCloseAutoFocus={() => {
              lastFocusedEditor()?.focus();
            }}
          >
            <div class="w-full flex gap-1 justify-center items-center p-1">
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

            <HorizontalBar />
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
          </DropdownMenuContent>
        </DropdownMenu.Portal>
      </DropdownMenu>
    );
  };

  const InlineFormatPopDown = (props: {
    formats: InlineFormat[];
    buttonIsDisabled: Accessor<boolean>;
  }) => {
    const [menuOpen, setMenuOpen] = createSignal(false);
    return (
      <DropdownMenu open={menuOpen()} onOpenChange={setMenuOpen}>
        <DropdownMenu.Trigger>
          <IconButton
            icon={TextAA}
            theme="clear"
            tooltip={{ label: 'Text Styles' }}
            showChevron
            disabled={props.buttonIsDisabled()}
            tabIndex={-1}
          />
        </DropdownMenu.Trigger>
        <Show when={!props.buttonIsDisabled()}>
          <DropdownMenu.Portal>
            <DropdownMenuContent
              class="w-fit"
              onCloseAutoFocus={() => {
                lastFocusedEditor()?.focus();
              }}
            >
              <div class="w-full flex gap-1 justify-center items-center p-1">
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
            </DropdownMenuContent>
          </DropdownMenu.Portal>
        </Show>
      </DropdownMenu>
    );
  };

  // Text formatting dropdown for more options
  const InlineFormatMenu = (props: {
    excludes?: InlineFormat[];
    icon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
    label?: string;
    buttonIsDisabled: Accessor<boolean>;
  }) => (
    <DropdownMenu>
      <DropdownMenu.Trigger>
        <IconButton
          icon={props.icon ?? ThreeDots}
          theme="clear"
          tooltip={{ label: props.label ?? 'More Formats' }}
          showChevron
          disabled={buttonIsDisabled()}
          tabIndex={-1}
        />
      </DropdownMenu.Trigger>
      <Show when={!buttonIsDisabled()}>
        <DropdownMenu.Portal>
          <DropdownMenuContent
            class="w-48"
            onCloseAutoFocus={() => {
              lastFocusedEditor()?.focus();
            }}
          >
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
          </DropdownMenuContent>
        </DropdownMenu.Portal>
      </Show>
    </DropdownMenu>
  );

  const ElementFormatMenu = (props: {
    elements: ElementName[];
    icon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
    label?: string;
    buttonIsDisabled: Accessor<boolean>;
  }) => (
    <DropdownMenu>
      <DropdownMenu.Trigger>
        <IconButton
          icon={props.icon ?? ThreeDots}
          theme="clear"
          tooltip={{ label: props.label ?? 'More Formats' }}
          showChevron
          disabled={buttonIsDisabled()}
          tabIndex={-1}
        />
      </DropdownMenu.Trigger>
      <Show when={!buttonIsDisabled()}>
        <DropdownMenu.Portal>
          <DropdownMenuContent
            class="w-42"
            onCloseAutoFocus={() => {
              lastFocusedEditor()?.focus();
            }}
          >
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
          </DropdownMenuContent>
        </DropdownMenu.Portal>
      </Show>
    </DropdownMenu>
  );

  const FullWithElementButtons: ElementName[] = [
    'heading1',
    'heading2',
    'heading3',
    'list-bullet',
    'list-number',
    'list-check',
    'code',
  ];

  if (props.withinPopup) {
    return (
      <div class="flex h-full gap-1">
        <Show when={canEdit()}>
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
          <IconButton
            icon={selection()?.hasLinks ? BrokenLinkIcon : LinkIcon}
            theme="clear"
            onClick={handleLink}
            tooltip={{
              label: selection()?.hasLinks ? 'Remove Link' : 'Insert Link',
            }}
            disabled={buttonIsDisabled()}
          />
        </Show>
        <Show when={ENABLE_MARKDOWN_COMMENTS && canComment()}>
          <IconButton
            tooltip={{
              label: 'Comment',
            }}
            theme="clear"
            icon={ChatTeardrop}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleInsertComment();
            }}
            disabled={commentButtonIsDisabled()}
          />
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
            <IconButton
              icon={selection()?.hasLinks ? BrokenLinkIcon : LinkIcon}
              theme="clear"
              onClick={handleLink}
              tooltip={{
                label: selection()?.hasLinks ? 'Remove Link' : 'Insert Link',
              }}
              disabled={buttonIsDisabled()}
            />
            <MediaSelector buttonIsDisabled={buttonIsDisabled} />
            <Show when={ENABLE_MARKDOWN_COMMENTS}>
              <IconButton
                tooltip={{
                  label: 'Comment',
                }}
                theme="clear"
                icon={ChatTeardrop}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleInsertComment();
                }}
                disabled={commentButtonIsDisabled()}
              />
            </Show>
            <VerticalBar />
            <DropdownMenu
              open={moreOptionsOpen()}
              onOpenChange={setMoreOptionsOpen}
            >
              <DropdownMenu.Trigger>
                <IconButton
                  icon={PlusSquare}
                  theme="clear"
                  tooltip={{ label: 'More' }}
                  showChevron
                  disabled={buttonIsDisabled()}
                  tabIndex={-1}
                />
              </DropdownMenu.Trigger>
              <Show when={!buttonIsDisabled()}>
                <DropdownMenu.Portal>
                  <DropdownMenuContent
                    class="w-42"
                    onCloseAutoFocus={() => {
                      lastFocusedEditor()?.focus();
                    }}
                  >
                    <MenuItem
                      icon={Quote}
                      text="Block Quote"
                      onClick={() => {
                        setMoreOptionsOpen(false);
                        nodeFormat('quote');
                      }}
                      disabled={buttonIsDisabled()}
                    />
                    <HorizontalBar />
                    <MenuItem
                      icon={Minus}
                      text="Divider"
                      onClick={() => {
                        setMoreOptionsOpen(false);
                        editor()?.dispatchCommand(
                          INSERT_HORIZONTAL_RULE_COMMAND,
                          undefined
                        );
                      }}
                      disabled={buttonIsDisabled()}
                    />
                    <MenuItem
                      icon={MathIcon}
                      text="Equation"
                      onClick={() => {
                        setMoreOptionsOpen(false);
                        handleInsertEquation();
                      }}
                      disabled={buttonIsDisabled()}
                    />
                    <DropdownMenu.Sub>
                      <SubTrigger
                        text="Table"
                        icon={Grid}
                        disabled={buttonIsDisabled()}
                      />
                      <DropdownMenu.Portal>
                        <DropdownMenu.SubContent>
                          <TableInsert
                            onMenuClose={() => setMoreOptionsOpen(false)}
                          />
                        </DropdownMenu.SubContent>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Sub>
                  </DropdownMenuContent>
                </DropdownMenu.Portal>
              </Show>
            </DropdownMenu>
          </div>

          {/* spacer before the AI button */}
          <div class="w-4"></div>
        </Show>
        <Show when={ENABLE_MARKDOWN_COMMENTS && canComment() && !canEdit()}>
          <IconButton
            tooltip={{
              label: 'Comment',
            }}
            theme="clear"
            icon={ChatTeardrop}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleInsertComment();
            }}
            disabled={commentButtonIsDisabled()}
          />
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
