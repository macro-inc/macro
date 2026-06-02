/**
 * @file This component rendered the accessory for the code nodes - a copy button and a syntax highlighting
 * language selector.
 */
import { isInBlock, useIsNestedBlock } from '@core/block';
import { toast } from '@core/component/Toast/Toast';
import { ENABLE_SVG_PREVIEW } from '@core/constant/featureFlags';
import { Switch } from '@kobalte/core/switch';
import { $isCodeNode, CodeNode } from '@lexical/code';
import {
  $isCustomCodeNode,
  LanguageDefinitions,
  normalizedLanguage,
  type SupportedLanguage,
} from '@lexical-core';
import Braces from '@phosphor/brackets-curly.svg';
import Copy from '@phosphor/copy.svg';
import FileC from '@phosphor/file-c.svg';
import FileCode from '@phosphor/file-code.svg';
import FileCpp from '@phosphor/file-cpp.svg';
import FileCss from '@phosphor/file-css.svg';
import FileHtml from '@phosphor/file-html.svg';
import FileJs from '@phosphor/file-js.svg';
import FileMd from '@phosphor/file-md.svg';
import FilePy from '@phosphor/file-py.svg';
import FileRs from '@phosphor/file-rs.svg';
import FileSql from '@phosphor/file-sql.svg';
import FileTs from '@phosphor/file-ts.svg';
import TrashCan from '@phosphor/trash-simple.svg';
import { Button, cn, Dropdown } from '@ui';
import {
  $getNodeByKey,
  type EditorThemeClasses,
  type LexicalEditor,
  type NodeKey,
} from 'lexical';
import {
  type Accessor,
  type Component,
  createEffect,
  createSignal,
  For,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { glueToElement } from '../../directive/glueToElement';
import { autoRegister } from '../../plugins/shared/utils';

false && glueToElement;

const LanguageIcons: Record<
  SupportedLanguage,
  Component<{ class?: string }>
> = {
  plaintext: FileCode,
  javascript: FileJs,
  typescript: FileTs,
  json: Braces,
  python: FilePy,
  rust: FileRs,
  java: FileCode,
  swift: FileCode,
  c: FileC,
  cpp: FileCpp,
  css: FileCss,
  html: FileHtml,
  markdown: FileMd,
  powershell: FileCode,
  sql: FileSql,
  bash: FileCode,
  svg: FileCode,
};

function StaticLabel(props: { language: SupportedLanguage }) {
  return (
    <div class="text-xs font-sans font-medium flex items-center gap-1 p-2 text-ink-extra-muted/50">
      <Dynamic component={LanguageIcons[props.language]} class="size-4" />
      <span>{LanguageDefinitions[props.language].label}</span>
    </div>
  );
}

function CodeLanguageSelector(props: {
  language: Accessor<string | null>;
  setLanguage: (language: string) => void;
  editor?: LexicalEditor;
}) {
  const [open, setOpen] = createSignal(false);
  const editable = () => {
    return props.editor && props.editor.isEditable();
  };
  const validCurrentLanguage = (): SupportedLanguage => {
    const language = props.language();
    if (language && language.toLowerCase() in LanguageDefinitions) {
      return language.toLowerCase() as SupportedLanguage;
    }
    return 'plaintext';
  };

  return (
    <Show
      when={editable()}
      fallback={<StaticLabel language={validCurrentLanguage()} />}
    >
      <Dropdown open={open()} onOpenChange={setOpen}>
        <Dropdown.Trigger
          variant="ghost"
          size="sm"
          class="text-ink-extra-muted/50 p-1.5"
          tabIndex={-1}
        >
          <Dynamic
            component={LanguageIcons[validCurrentLanguage()]}
            class="size-4"
          />
          <span>{LanguageDefinitions[validCurrentLanguage()].label}</span>
        </Dropdown.Trigger>
        <Dropdown.Content>
          <Dropdown.Group>
            <For
              each={Object.entries(LanguageDefinitions).filter(
                ([, info]) => info.show
              )}
            >
              {([key, info]) => (
                <Dropdown.Item
                  onSelect={() => {
                    props.setLanguage(key);
                  }}
                >
                  <Dynamic
                    component={
                      LanguageIcons[key as SupportedLanguage] ??
                      LanguageIcons.plaintext
                    }
                    class="size-4 shrink-0"
                  />
                  <span class="flex-1 truncate">{info.label}</span>
                </Dropdown.Item>
              )}
            </For>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
}

export function CodeBoxAccessory(props: {
  floatRef: HTMLElement;
  editor: LexicalEditor;
  nodeKey: NodeKey;
}) {
  const [language, setLanguage] = createSignal('JavaScript');
  const [isPreviewMode, setIsPreviewMode] = createSignal(false);

  const isNested = isInBlock() && useIsNestedBlock();

  if (ENABLE_SVG_PREVIEW) {
    autoRegister(
      props.editor.registerMutationListener(
        CodeNode,
        (mutations) => {
          const match = mutations.get(props.nodeKey);
          if (match === 'created' || match === 'updated') {
            queueMicrotask(() =>
              props.editor.read(() => {
                const node = $getNodeByKey(props.nodeKey);
                if (!$isCodeNode(node)) return;
                setLanguage(node.getLanguage() ?? 'plain');
                if ($isCustomCodeNode(node)) {
                  setIsPreviewMode(node.getPreviewEnabled());
                }
              })
            );
          }
        },
        { skipInitialization: false }
      )
    );
  }

  const copyCode = () => {
    const code = props.editor.read(() => {
      const node = $getNodeByKey(props.nodeKey);
      if (!node) return '';
      return node.getTextContent();
    });
    if (!code) return;
    try {
      navigator.clipboard.writeText(code);
      toast.success('Copied code to clipboard');
    } catch (e) {
      console.error('Failed to copy code to clipboard', e);
    }
  };

  const deleteCode = () => {
    props.editor.update(() => {
      const node = $getNodeByKey(props.nodeKey);
      if (!$isCodeNode(node)) return;
      node.remove();
    });
  };

  const setLanguageOnNode = (language: string) => {
    props.editor.update(() => {
      const node = $getNodeByKey(props.nodeKey);
      if (!$isCustomCodeNode(node)) return;
      node.setLanguage(language);
      setIsPreviewMode(node.getPreviewEnabled());
    });
  };

  const setPreviewModeOnNode = (enabled: boolean) => {
    props.editor.update(() => {
      const node = $getNodeByKey(props.nodeKey);
      if (!$isCustomCodeNode(node)) return;
      node.setPreviewEnabled(enabled);
    });
  };

  const showPreviewToggle = () => {
    return ENABLE_SVG_PREVIEW && language().toLowerCase() === 'svg';
  };

  createEffect(() => {
    if (isNested) return;
    props.floatRef.classList.add('__accessory-code-box');
  });

  return (
    <Show when={!isNested}>
      <div
        class="fixed pointer-events-none md-code-box-header"
        ref={(el) => {
          glueToElement(el, () => ({
            editor: props.editor,
            element: () => props.floatRef,
          }));
        }}
      >
        <div class="w-full flex justify-between content-center items-start p-1 pointer-events-auto text-ink-extra-muted/50">
          <CodeLanguageSelector
            language={language}
            setLanguage={setLanguageOnNode}
            editor={props.editor}
          />
          <div class="flex items-center h-full">
            <Show when={showPreviewToggle()}>
              <div class="flex items-center gap-2 mr-2">
                <div class="text-xs text-ink-extra-muted/50">Preview</div>
                <Switch
                  checked={isPreviewMode()}
                  onChange={(enabled) => {
                    setIsPreviewMode(enabled);
                    setPreviewModeOnNode(enabled);
                  }}
                >
                  <Switch.Input class="sr-only" />
                  <Switch.Control class="inline-flex h-4 w-8 hover:ring-1 hover:ring-edge rounded-full border-2 border-transparent transition-colors bg-edge focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 data-checked:bg-accent">
                    <Switch.Thumb class="block size-3 rounded-full bg-surface transition-transform data-checked:translate-x-4" />
                  </Switch.Control>
                </Switch>
              </div>
            </Show>
            <Show when={props.editor.isEditable()}>
              <Button
                variant="ghost"
                size="icon-sm"
                class="text-ink-extra-muted/50 hover:text-failure h-full"
                tooltip="Delete Code"
                on:click={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  deleteCode();
                }}
              >
                <TrashCan />
              </Button>
            </Show>
            <Button
              variant="ghost"
              size="icon-sm"
              class="text-ink-extra-muted/50 h-full"
              tooltip="Copy Code"
              on:click={(e) => {
                e.stopPropagation();
                e.preventDefault();
                copyCode();
              }}
            >
              <Copy />
            </Button>
          </div>
        </div>
        <Show when={isPreviewMode() && showPreviewToggle()}>
          <SvgPreview
            svgContent={() => {
              return props.editor.read(() => {
                const node = $getNodeByKey(props.nodeKey);
                if (!node) return '';
                return node.getTextContent();
              });
            }}
            overlay={true}
          />
        </Show>
      </div>
    </Show>
  );
}

function SvgPreview(props: { svgContent: () => string; overlay?: boolean }) {
  const [error, setError] = createSignal<string | null>(null);

  const sanitizeSvg = (content: string): string => {
    // Remove potentially dangerous elements/attributes
    return content
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
      .replace(/javascript:/gi, '');
  };

  const renderSvg = () => {
    const content = props.svgContent();
    if (!content.trim()) {
      return (
        <div class="flex items-center justify-center h-full text-ink-extra-muted/50 text-sm">
          No SVG content
        </div>
      );
    }

    try {
      const trimmedContent = content.trim().toLowerCase();
      if (
        !trimmedContent.startsWith('<svg') &&
        !trimmedContent.includes('<svg')
      ) {
        setError('Content does not appear to be valid SVG');
        return (
          <div class="flex items-center justify-center h-full text-failure text-sm">
            Invalid SVG content
          </div>
        );
      }
      const sanitizedContent = sanitizeSvg(content);

      let containerRef: HTMLDivElement | undefined;

      const setContainerRef = (el: HTMLDivElement) => {
        containerRef = el;
        setTimeout(() => {
          if (containerRef) {
            const svgElements = containerRef.querySelectorAll('svg');
            svgElements.forEach((svg: SVGElement) => {
              svg.style.maxWidth = '100%';
              svg.style.maxHeight = '100%';
              svg.style.width = 'auto';
              svg.style.height = 'auto';
              svg.style.display = 'block';
              svg.style.margin = 'auto';
            });
          }
        }, 0);
      };

      return (
        <div class="size-full overflow-hidden p-2">
          <div
            ref={setContainerRef}
            class="size-full flex items-center justify-center min-h-0"
            innerHTML={sanitizedContent}
          />
        </div>
      );
    } catch (_e) {
      setError('Failed to render SVG');
      return (
        <div class="flex items-center justify-center h-full text-failure text-sm">
          Failed to render SVG: {error()}
        </div>
      );
    }
  };

  return (
    <div class={'absolute top-12 inset-x-0 bottom-0 z-10 p-2'}>
      {renderSvg()}
    </div>
  );
}

export const StaticCodeBoxAccessory = (props: {
  language: string;
  code: string;
  theme: EditorThemeClasses;
  isPreviewMode?: () => boolean;
  setIsPreviewMode?: (enabled: boolean) => void;
}) => {
  let ref!: HTMLDivElement;
  const [localPreviewMode, setLocalPreviewMode] = createSignal(false);

  // Use props if provided, otherwise fall back to local state
  const isPreviewMode = () => props.isPreviewMode?.() ?? localPreviewMode();
  const setIsPreviewMode = props.setIsPreviewMode ?? setLocalPreviewMode;

  const copyCode = () => {
    const code = props.code;
    if (!code) return;
    try {
      navigator.clipboard.writeText(code);
      toast.success('Copied code to clipboard');
    } catch (e) {
      console.error('Failed to copy code to clipboard', e);
    }
  };

  const textColor = () => 'text-ink-extra-muted/50';
  const language = () => normalizedLanguage(props.language);

  const showPreviewToggle = () => {
    return ENABLE_SVG_PREVIEW && language().toLowerCase() === 'svg';
  };

  return (
    <>
      <div
        class={cn(
          'md-code-box-header w-full flex absolute top-0 left-0 justify-between content-center items-center p-1 pointer-events-auto select-none',
          textColor()
        )}
        ref={ref}
      >
        <StaticLabel language={language()} />
        <div class="flex gap-2 items-center">
          <Show when={showPreviewToggle()}>
            <div class="flex items-center gap-2">
              <div class={cn('text-xs', textColor())}>Preview</div>
              <Switch checked={isPreviewMode()} onChange={setIsPreviewMode}>
                <Switch.Input class="sr-only" />
                <Switch.Control class="inline-flex h-4 w-8 hover:ring-1 hover:ring-edge rounded-full border-2 border-transparent transition-colors bg-edge focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 data-checked:bg-accent">
                  <Switch.Thumb class="block size-3 rounded-full transition-transform data-checked:translate-x-4 bg-surface" />
                </Switch.Control>
              </Switch>
            </div>
          </Show>
          <Button
            variant="ghost"
            size="icon-sm"
            class="text-ink-extra-muted/50 h-full"
            tooltip="Copy Code"
            on:click={(e) => {
              e.stopPropagation();
              e.preventDefault();
              copyCode();
            }}
          >
            <Copy />
          </Button>
        </div>
      </div>
      <Show when={isPreviewMode() && showPreviewToggle()}>
        <SvgPreview svgContent={() => props.code} overlay={false} />
      </Show>
    </>
  );
};
