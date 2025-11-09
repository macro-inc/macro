/**
 * @file This component rendered the accessory for the code nodes - a copy button and a syntax highlighting
 * language selector.
 */

import { isInBlock, useIsNestedBlock } from '@core/block';
import { IconButton } from '@core/component/IconButton';
import { DropdownMenuContent, MenuItem } from '@core/component/Menu';
import { TextButton } from '@core/component/TextButton';
import { toast } from '@core/component/Toast/Toast';
import { ENABLE_SVG_PREVIEW } from '@core/constant/featureFlags';
import Braces from '@icon/regular/brackets-curly.svg';
import Copy from '@icon/regular/copy.svg';
import FileC from '@icon/regular/file-c.svg';
import FileCode from '@icon/regular/file-code.svg';
import FileCpp from '@icon/regular/file-cpp.svg';
import FileCss from '@icon/regular/file-css.svg';
import FileHtml from '@icon/regular/file-html.svg';
import FileJs from '@icon/regular/file-js.svg';
import FileMd from '@icon/regular/file-md.svg';
import FilePy from '@icon/regular/file-py.svg';
import FileRs from '@icon/regular/file-rs.svg';
import FileSql from '@icon/regular/file-sql.svg';
import FileTs from '@icon/regular/file-ts.svg';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { Switch } from '@kobalte/core/switch';
import { $isCodeNode, CodeNode } from '@lexical/code';
import {
  $isCustomCodeNode,
  LanguageDefinitions,
  normalizedLanguage,
  type SupportedLanguage,
} from '@lexical-core';
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
    <div class="text-sm font-sans font-medium flex items-center gap-2 p-2 text-ink-extra-muted">
      <Dynamic component={LanguageIcons[props.language]} class="size-4" />
      <span>{LanguageDefinitions[props.language].label}</span>
    </div>
  );
}

export function CodeLanguageSelector(props: {
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
    <DropdownMenu open={open() && editable()} onOpenChange={setOpen}>
      <DropdownMenu.Trigger>
        <Show
          when={editable()}
          fallback={<StaticLabel language={validCurrentLanguage()} />}
        >
          <TextButton
            // TODO: Icon mapping moved to frontend package
            icon={LanguageIcons[validCurrentLanguage()]}
            theme="extraMuted"
            text={LanguageDefinitions[validCurrentLanguage()].label}
            showChevron
            tabIndex={-1}
          />
        </Show>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenuContent class="w-42 z-[1200]">
          <For
            each={Object.entries(LanguageDefinitions).filter(
              ([, info]) => info.show
            )}
          >
            {([key, info]) => (
              <MenuItem
                text={info.label}
                icon={
                  LanguageIcons[key as SupportedLanguage] ??
                  LanguageIcons.plaintext
                }
                onClick={() => {
                  props.setLanguage(key);
                }}
              />
            )}
          </For>
        </DropdownMenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu>
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
        use:glueToElement={{
          element: () => props.floatRef,
          editor: props.editor,
        }}
      >
        <div class="w-full flex justify-between content-center items-center p-1 pointer-events-auto text-ink-extra-muted">
          <CodeLanguageSelector
            language={language}
            setLanguage={setLanguageOnNode}
            editor={props.editor}
          />
          <div class="flex gap-2 items-center">
            <Show when={showPreviewToggle()}>
              <div class="flex items-center gap-2">
                <div class="text-xs text-ink-extra-muted">Preview</div>
                <Switch
                  checked={isPreviewMode()}
                  onChange={(enabled) => {
                    setIsPreviewMode(enabled);
                    setPreviewModeOnNode(enabled);
                  }}
                >
                  <Switch.Input class="sr-only" />
                  <Switch.Control class="inline-flex h-4 w-8 hover:ring-1 hover:ring-edge rounded-full border-2 border-transparent transition-colors bg-edge focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 data-[checked]:bg-accent">
                    <Switch.Thumb class="block h-3 w-3 rounded-full bg-dialog transition-transform data-[checked]:translate-x-4" />
                  </Switch.Control>
                </Switch>
              </div>
            </Show>
            <IconButton
              theme="extraMuted"
              icon={Copy}
              tooltip={{ label: 'Copy Code' }}
              on:click={(e) => {
                e.stopPropagation();
                e.preventDefault();
                copyCode();
              }}
            />
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
        <div class="flex items-center justify-center h-full text-ink-muted text-sm">
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
        <div class="w-full h-full overflow-hidden p-2">
          <div
            ref={setContainerRef}
            class="w-full h-full flex items-center justify-center min-h-0"
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
    <div class={'absolute top-12 left-0 right-0 bottom-0 z-10 p-2'}>
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

  const textColor = () => 'text-ink-extra-muted';
  const language = () => normalizedLanguage(props.language);

  const showPreviewToggle = () => {
    return ENABLE_SVG_PREVIEW && language().toLowerCase() === 'svg';
  };

  return (
    <>
      <div
        class={`md-code-box-header w-full flex absolute top-0 left-0 justify-between content-center items-center p-1 pointer-events-auto select-none ${textColor()}`}
        ref={ref}
      >
        <StaticLabel language={language()} />
        <div class="flex gap-2 items-center">
          <Show when={showPreviewToggle()}>
            <div class="flex items-center gap-2">
              <div class={`text-xs ${textColor()}`}>Preview</div>
              <Switch checked={isPreviewMode()} onChange={setIsPreviewMode}>
                <Switch.Input class="sr-only" />
                <Switch.Control
                  class={`inline-flex h-4 w-8 hover:ring-1 hover:ring-edge rounded-full border-2 border-transparent transition-colors bg-edge focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 data-[checked]:bg-accent`}
                >
                  <Switch.Thumb
                    class={`block h-3 w-3 rounded-full transition-transform data-[checked]:translate-x-4 bg-dialog`}
                  />
                </Switch.Control>
              </Switch>
            </div>
          </Show>
          <IconButton
            theme="extraMuted"
            icon={() => <Copy class={`size-5 ${textColor()}`} />}
            tooltip={{ label: 'Copy Code' }}
            on:click={(e) => {
              e.stopPropagation();
              e.preventDefault();
              copyCode();
            }}
          />
        </div>
      </div>
      <Show when={isPreviewMode() && showPreviewToggle()}>
        <SvgPreview svgContent={() => props.code} overlay={false} />
      </Show>
    </>
  );
};
