/**
 * @file This component rendered the accessory for the code nodes - a copy button and a syntax highlighting
 * language selector.
 */
import { isInBlock, useIsNestedBlock } from '@core/block';
import { ENABLE_SVG_PREVIEW } from '@core/constant/featureFlags';
import Braces from '@icon/system/regular/brackets-curly.svg';
import Copy from '@icon/system/regular/copy.svg';
import FileC from '@icon/system/regular/file-c.svg';
import FileCode from '@icon/system/regular/file-code.svg';
import FileCpp from '@icon/system/regular/file-cpp.svg';
import FileCss from '@icon/system/regular/file-css.svg';
import FileHtml from '@icon/system/regular/file-html.svg';
import FileJs from '@icon/system/regular/file-js.svg';
import FileMd from '@icon/system/regular/file-md.svg';
import FilePy from '@icon/system/regular/file-py.svg';
import FileRs from '@icon/system/regular/file-rs.svg';
import FileSql from '@icon/system/regular/file-sql.svg';
import FileTs from '@icon/system/regular/file-ts.svg';
import TrashCan from '@icon/system/regular/trash-simple.svg';
import {
  LanguageDefinitions,
  normalizedLanguage,
  type SupportedLanguage,
} from '@macro-inc/lexical-core';
import { Button, CopyButton, cn, Dropdown, ToggleSwitch } from '@ui';
import type { EditorThemeClasses } from 'lexical';
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
import type { CodeAccessoryHost } from './code-accessory-host';
import { prepareSvgPreview, sizeSvgPreview } from './svg-preview';

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
      <span class="select-none">
        {LanguageDefinitions[props.language].label}
      </span>
    </div>
  );
}

function CodeLanguageSelector(props: {
  language: Accessor<string | null>;
  setLanguage: (language: string) => void;
  editable: boolean;
}) {
  const [open, setOpen] = createSignal(false);
  const editable = () => props.editable;
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
  host: CodeAccessoryHost;
}) {
  const host = props.host;
  const floatRef = () => host.mountElement?.() ?? props.floatRef;
  const language = host.language;
  const isPreviewMode = host.previewEnabled;
  const setIsPreviewMode = host.setPreviewEnabledLocally;

  const isNested = isInBlock() && useIsNestedBlock();

  const copyCode = async () => {
    const code = host.codeText();
    if (!code) return false;
    try {
      await navigator.clipboard.writeText(code);
      return true;
    } catch (e) {
      console.error('Failed to copy code to clipboard', e);
      return false;
    }
  };

  const showPreviewToggle = () => {
    return ENABLE_SVG_PREVIEW && language().toLowerCase() === 'svg';
  };

  createEffect(() => {
    if (isNested) return;
    floatRef().classList.add('__accessory-code-box');
  });

  return (
    <Show when={!isNested}>
      <div
        class="fixed pointer-events-none md-code-box-header"
        ref={(el) => {
          glueToElement(el, () => ({
            root: host.root,
            observeMutations: host.observeMutations,
            element: floatRef,
          }));
        }}
      >
        <div class="w-full flex justify-between content-center items-start p-1 pointer-events-auto text-ink-extra-muted/50">
          <CodeLanguageSelector
            language={language}
            setLanguage={host.setLanguage}
            editable={host.editableAtMount}
          />
          <div class="flex items-center h-full">
            <Show when={showPreviewToggle()}>
              <div class="flex items-center gap-2 mr-2">
                <div class="text-xs text-ink-extra-muted/50">Preview</div>
                <ToggleSwitch
                  size="sm"
                  label="Preview"
                  labelClass="sr-only"
                  checked={isPreviewMode()}
                  onChange={(enabled) => {
                    setIsPreviewMode(enabled);
                    host.setPreviewEnabled(enabled);
                  }}
                />
              </div>
            </Show>
            <Show when={host.editableAtMount}>
              <Button
                variant="ghost"
                size="icon-sm"
                class="text-ink-extra-muted/50 hover:text-failure h-full"
                tooltip="Delete Code"
                on:click={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  host.deleteCode();
                }}
              >
                <TrashCan class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
              </Button>
            </Show>
            <CopyButton
              variant="ghost"
              size="icon-sm"
              class="text-ink-extra-muted/50 h-full"
              tooltip="Copy Code"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                return copyCode();
              }}
            >
              <Copy class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
            </CopyButton>
          </div>
        </div>
        <Show when={isPreviewMode() && showPreviewToggle()}>
          <SvgPreview svgContent={host.codeText} overlay={true} />
        </Show>
      </div>
    </Show>
  );
}

function SvgPreview(props: { svgContent: () => string; overlay?: boolean }) {
  const [error, setError] = createSignal<string | null>(null);

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
      const prepared = prepareSvgPreview(content);
      if (prepared.kind === 'invalid') {
        setError('Content does not appear to be valid SVG');
        return (
          <div class="flex items-center justify-center h-full text-failure text-sm">
            Invalid SVG content
          </div>
        );
      }
      if (prepared.kind === 'empty') return;
      const sanitizedContent = prepared.html;

      let containerRef: HTMLDivElement | undefined;

      const setContainerRef = (el: HTMLDivElement) => {
        containerRef = el;
        setTimeout(() => {
          if (containerRef) {
            sizeSvgPreview(containerRef);
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
    <div class="absolute top-12 inset-x-0 bottom-0 z-10 p-2">{renderSvg()}</div>
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

  const copyCode = async () => {
    const code = props.code;
    if (!code) return false;
    try {
      await navigator.clipboard.writeText(code);
      return true;
    } catch (e) {
      console.error('Failed to copy code to clipboard', e);
      return false;
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
              <ToggleSwitch
                size="sm"
                label="Preview"
                labelClass="sr-only"
                checked={isPreviewMode()}
                onChange={setIsPreviewMode}
              />
            </div>
          </Show>
          <CopyButton
            variant="ghost"
            size="icon-sm"
            class="text-ink-extra-muted/50 h-full"
            tooltip="Copy Code"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              return copyCode();
            }}
          >
            <Copy class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
          </CopyButton>
        </div>
      </div>
      <Show when={isPreviewMode() && showPreviewToggle()}>
        <SvgPreview svgContent={() => props.code} overlay={false} />
      </Show>
    </>
  );
};
