/** Less-used typography controls, opened beside the inspector. */
import type { TextInfo } from '@core/fig-engine/types';
import { Popover } from '@kobalte/core/popover';
import SlidersHorizontal from '@phosphor/sliders-horizontal.svg';
import TextItalic from '@phosphor/text-italic.svg';
import TextStrikethrough from '@phosphor/text-strikethrough.svg';
import TextUnderline from '@phosphor/text-underline.svg';
import X from '@phosphor/x.svg';
import type { MixedTextField } from '../core/rich-text';
import { parseStyle, styleName } from '../core/type';
import type { Patch } from '../primitives/create-fig-editor';
import { NumberField } from './design-fields';
import { InspectorSelect } from './inspector-select';

const CASES = [
  ['ORIGINAL', 'As typed'],
  ['UPPER', 'Uppercase'],
  ['LOWER', 'Lowercase'],
  ['TITLE', 'Title Case'],
] as const;

export function TypeSettings(props: {
  anchor: () => HTMLElement | undefined;
  text: TextInfo;
  mixed?: ReadonlySet<MixedTextField>;
  onPatch: (patch: Patch, live: boolean) => void;
}) {
  const style = () => parseStyle(props.text.fontStyle);
  const decoration = () =>
    props.mixed?.has('decoration') ? 'MIXED' : props.text.decoration;
  const toggleDecoration = (value: 'UNDERLINE' | 'STRIKETHROUGH') =>
    props.onPatch(
      { textDecoration: decoration() === value ? 'NONE' : value },
      false
    );
  return (
    <Popover placement="left-start" gutter={24} anchorRef={props.anchor}>
      <Popover.Trigger
        aria-label="Type settings"
        title="Type settings"
        data-testid="fig-type-settings"
        class="flex size-7 items-center justify-center rounded text-ink-muted hover:bg-hover hover:text-ink"
      >
        <SlidersHorizontal class="size-4" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          class="fig-editor-theme z-modal w-64 rounded-xl border border-edge-muted bg-menu p-3 text-ink text-xs shadow-xl outline-none"
          aria-label="Type settings"
          onKeyDown={(e) => {
            if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div class="mb-3 flex items-center justify-between">
            <Popover.Title class="font-medium">Type settings</Popover.Title>
            <Popover.CloseButton
              aria-label="Close type settings"
              class="rounded p-1 hover:bg-hover"
            >
              <X class="size-3.5" />
            </Popover.CloseButton>
          </div>
          <div class="flex flex-col gap-2">
            <span class="text-ink-muted">Decoration</span>
            <div class="flex gap-1 rounded-md bg-inset p-1">
              <button
                type="button"
                aria-label="Italic"
                title="Italic"
                data-testid="fig-italic"
                aria-pressed={!props.mixed?.has('fontStyle') && style().italic}
                class="flex h-7 flex-1 items-center justify-center rounded text-ink-muted hover:text-ink aria-pressed:bg-hover aria-pressed:text-ink"
                onClick={() =>
                  props.onPatch(
                    { fontStyle: styleName(style().weight, !style().italic) },
                    false
                  )
                }
              >
                <TextItalic class="size-4" />
              </button>
              <button
                type="button"
                aria-label="Underline"
                title="Underline"
                data-testid="fig-underline"
                aria-pressed={decoration() === 'UNDERLINE'}
                class="flex h-7 flex-1 items-center justify-center rounded text-ink-muted hover:text-ink aria-pressed:bg-hover aria-pressed:text-ink"
                onClick={() => toggleDecoration('UNDERLINE')}
              >
                <TextUnderline class="size-4" />
              </button>
              <button
                type="button"
                aria-label="Strikethrough"
                title="Strikethrough"
                data-testid="fig-strikethrough"
                aria-pressed={decoration() === 'STRIKETHROUGH'}
                class="flex h-7 flex-1 items-center justify-center rounded text-ink-muted hover:text-ink aria-pressed:bg-hover aria-pressed:text-ink"
                onClick={() => toggleDecoration('STRIKETHROUGH')}
              >
                <TextStrikethrough class="size-4" />
              </button>
            </div>
            <label class="flex flex-col gap-1">
              <span class="text-ink-muted">Letter case</span>
              <InspectorSelect
                label="Case"
                testId="fig-text-case"
                value={
                  props.mixed?.has('case')
                    ? 'mixed'
                    : (props.text.case ?? 'ORIGINAL')
                }
                options={[
                  ...(props.mixed?.has('case')
                    ? [{ value: 'mixed', label: 'Mixed', disabled: true }]
                    : []),
                  ...CASES.map(([value, label]) => ({ value, label })),
                ]}
                onChange={(value) =>
                  props.onPatch({ textCase: value as Patch['textCase'] }, false)
                }
              />
            </label>
            <span class="text-ink-muted">Paragraph spacing</span>
            <NumberField
              label="¶"
              ariaLabel="Paragraph spacing"
              value={props.text.paragraphSpacing ?? 0}
              min={0}
              testId="fig-field-paragraph-spacing"
              onChange={(paragraphSpacing, live) =>
                props.onPatch({ paragraphSpacing }, live)
              }
            />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
