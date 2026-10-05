/**
 * The editable Type section: family, weight and italic, size, line height,
 * letter spacing, paragraph spacing, alignment, resizing, decoration, and
 * case, laid out as Figma's design panel does. With characters selected in
 * the text editor it shows (and sets) theirs, "Mixed" where they differ.
 * Presentational.
 */

import type { TextInfo } from '@core/fig-engine/types';
import AlignBottomSimple from '@phosphor/align-bottom-simple.svg';
import AlignCenterVerticalSimple from '@phosphor/align-center-vertical-simple.svg';
import AlignTopSimple from '@phosphor/align-top-simple.svg';
import ArrowsOutLineHorizontal from '@phosphor/arrows-out-line-horizontal.svg';
import ArrowsOutLineVertical from '@phosphor/arrows-out-line-vertical.svg';
import FrameCorners from '@phosphor/frame-corners.svg';
import TextAlignCenter from '@phosphor/text-align-center.svg';
import TextAlignJustify from '@phosphor/text-align-justify.svg';
import TextAlignLeft from '@phosphor/text-align-left.svg';
import TextAlignRight from '@phosphor/text-align-right.svg';
import TextItalic from '@phosphor/text-italic.svg';
import TextStrikethrough from '@phosphor/text-strikethrough.svg';
import TextUnderline from '@phosphor/text-underline.svg';
import { For, type JSX, Show } from 'solid-js';
import type { MixedTextField } from '../core/rich-text';
import {
  formatLetterSpacing,
  formatLineHeight,
  parseLetterSpacing,
  parseLineHeight,
  parseStyle,
  styleName,
  WEIGHTS,
} from '../core/type';
import type { Patch } from '../primitives/create-fig-editor';
import { ChoiceRow, NumberField, ParsedField } from './design-fields';
import { FontPicker } from './font-picker';

const icon = 'size-3.5';

const H_ALIGN = [
  { value: 'LEFT', label: 'Align left', icon: <TextAlignLeft class={icon} /> },
  {
    value: 'CENTER',
    label: 'Align center',
    icon: <TextAlignCenter class={icon} />,
  },
  {
    value: 'RIGHT',
    label: 'Align right',
    icon: <TextAlignRight class={icon} />,
  },
  {
    value: 'JUSTIFIED',
    label: 'Justify',
    icon: <TextAlignJustify class={icon} />,
  },
] as const;

const V_ALIGN = [
  { value: 'TOP', label: 'Align top', icon: <AlignTopSimple class={icon} /> },
  {
    value: 'CENTER',
    label: 'Align middle',
    icon: <AlignCenterVerticalSimple class={icon} />,
  },
  {
    value: 'BOTTOM',
    label: 'Align bottom',
    icon: <AlignBottomSimple class={icon} />,
  },
] as const;

const RESIZE = [
  {
    value: 'WIDTH_AND_HEIGHT',
    label: 'Auto width',
    icon: <ArrowsOutLineHorizontal class={icon} />,
  },
  {
    value: 'HEIGHT',
    label: 'Auto height',
    icon: <ArrowsOutLineVertical class={icon} />,
  },
  { value: 'NONE', label: 'Fixed size', icon: <FrameCorners class={icon} /> },
] as const;

const CASES = [
  ['ORIGINAL', 'As typed'],
  ['UPPER', 'Uppercase'],
  ['LOWER', 'Lowercase'],
  ['TITLE', 'Title Case'],
] as const;

function Select(props: {
  label: string;
  testId: string;
  value: string;
  onChange: (value: string) => void;
  children: JSX.Element;
}) {
  return (
    <select
      class="min-w-0 rounded-md bg-inset px-2 py-1 text-ink outline-none focus:outline focus:outline-1 focus:outline-accent"
      aria-label={props.label}
      data-testid={props.testId}
      value={props.value}
      onChange={(e) => props.onChange(e.currentTarget.value)}
    >
      {props.children}
    </select>
  );
}

export function TypeControls(props: {
  text: TextInfo;
  /** Fields the selected characters differ in. */
  mixed?: ReadonlySet<MixedTextField>;
  /** The document's font families. */
  families: readonly string[];
  /** Google Fonts families, for the picker. */
  googleFamilies?: readonly string[];
  /** Weights the family has, when known. */
  weights?: readonly number[];
  preview?: (family: string) => Promise<string | undefined>;
  onFontsOpen?: () => void;
  onPatch: (patch: Patch, live: boolean) => void;
}) {
  const t = () => props.text;
  const isMixed = (field: MixedTextField) => props.mixed?.has(field) ?? false;
  const style = () => parseStyle(t().fontStyle);
  const families = () => {
    const current = t().fontFamily;
    return current && !props.families.includes(current)
      ? [current, ...props.families]
      : props.families;
  };
  const weights = () =>
    WEIGHTS.filter(
      ([w]) =>
        !props.weights ||
        props.weights.length === 0 ||
        props.weights.includes(w) ||
        w === style().weight
    );
  const decoration = () =>
    isMixed('decoration') ? 'MIXED' : (t().decoration ?? 'NONE');
  const toggleDecoration = (d: 'UNDERLINE' | 'STRIKETHROUGH') =>
    props.onPatch({ textDecoration: decoration() === d ? 'NONE' : d }, false);
  return (
    <div class="flex flex-col gap-1.5" data-testid="fig-type">
      <FontPicker
        value={isMixed('fontFamily') ? null : (t().fontFamily ?? 'Inter')}
        documentFamilies={families()}
        googleFamilies={props.googleFamilies ?? []}
        missing={t().fontStatus !== 'AVAILABLE'}
        preview={props.preview}
        onOpen={props.onFontsOpen}
        onSelect={(fontFamily) => props.onPatch({ fontFamily }, false)}
      />
      <div class="grid grid-cols-[1fr_auto] gap-1.5">
        <Select
          label="Font weight"
          testId="fig-font-weight"
          value={isMixed('fontStyle') ? 'mixed' : String(style().weight)}
          onChange={(w) =>
            props.onPatch(
              { fontStyle: styleName(Number(w), style().italic) },
              false
            )
          }
        >
          <Show when={isMixed('fontStyle')}>
            <option value="mixed" selected disabled>
              Mixed
            </option>
          </Show>
          <For each={weights()}>
            {([w, name]) => (
              <option
                value={String(w)}
                selected={!isMixed('fontStyle') && w === style().weight}
              >
                {name}
              </option>
            )}
          </For>
        </Select>
        <button
          type="button"
          aria-label="Italic"
          title="Italic"
          aria-pressed={!isMixed('fontStyle') && style().italic}
          data-testid="fig-italic"
          class="rounded-md bg-inset px-2 text-ink-muted hover:text-ink aria-pressed:bg-hover aria-pressed:text-ink"
          onClick={() =>
            props.onPatch(
              { fontStyle: styleName(style().weight, !style().italic) },
              false
            )
          }
        >
          <TextItalic class={icon} />
        </button>
      </div>
      <div class="grid grid-cols-2 gap-1.5">
        <NumberField
          label="Size"
          value={t().fontSize ?? 12}
          mixed={isMixed('fontSize')}
          min={1}
          testId="fig-field-font-size"
          onChange={(fontSize, live) => props.onPatch({ fontSize }, live)}
        />
        <ParsedField
          label="Line"
          shown={
            isMixed('lineHeight') ? 'Mixed' : formatLineHeight(t().lineHeight)
          }
          parse={parseLineHeight}
          testId="fig-field-line-height"
          onChange={(lineHeight) => props.onPatch({ lineHeight }, false)}
        />
        <ParsedField
          label="Letter"
          shown={
            isMixed('letterSpacing')
              ? 'Mixed'
              : formatLetterSpacing(t().letterSpacing)
          }
          parse={parseLetterSpacing}
          testId="fig-field-letter-spacing"
          onChange={(letterSpacing) => props.onPatch({ letterSpacing }, false)}
        />
        <NumberField
          label="¶"
          value={t().paragraphSpacing ?? 0}
          min={0}
          testId="fig-field-paragraph-spacing"
          onChange={(paragraphSpacing, live) =>
            props.onPatch({ paragraphSpacing }, live)
          }
        />
      </div>
      <div class="grid grid-cols-[4fr_3fr] gap-1.5">
        <ChoiceRow
          value={t().alignHorizontal ?? 'LEFT'}
          options={H_ALIGN}
          testId="fig-text-align"
          onChange={(textAlignHorizontal) =>
            props.onPatch({ textAlignHorizontal }, false)
          }
        />
        <ChoiceRow
          value={t().alignVertical ?? 'TOP'}
          options={V_ALIGN}
          testId="fig-text-align-vertical"
          onChange={(textAlignVertical) =>
            props.onPatch({ textAlignVertical }, false)
          }
        />
      </div>
      <div class="grid grid-cols-[3fr_2fr_3fr] gap-1.5">
        <ChoiceRow
          value={t().autoResize ?? 'NONE'}
          options={RESIZE}
          testId="fig-text-resize"
          onChange={(textAutoResize) =>
            props.onPatch({ textAutoResize }, false)
          }
        />
        <div class="flex items-center gap-0.5 rounded-md bg-inset p-0.5">
          <button
            type="button"
            aria-label="Underline"
            title="Underline"
            aria-pressed={decoration() === 'UNDERLINE'}
            data-testid="fig-underline"
            class="flex flex-1 items-center justify-center rounded p-1 text-ink-muted hover:text-ink aria-pressed:bg-hover aria-pressed:text-ink"
            onClick={() => toggleDecoration('UNDERLINE')}
          >
            <TextUnderline class={icon} />
          </button>
          <button
            type="button"
            aria-label="Strikethrough"
            title="Strikethrough"
            aria-pressed={decoration() === 'STRIKETHROUGH'}
            class="flex flex-1 items-center justify-center rounded p-1 text-ink-muted hover:text-ink aria-pressed:bg-hover aria-pressed:text-ink"
            onClick={() => toggleDecoration('STRIKETHROUGH')}
          >
            <TextStrikethrough class={icon} />
          </button>
        </div>
        <Select
          label="Case"
          testId="fig-text-case"
          value={isMixed('case') ? 'mixed' : (t().case ?? 'ORIGINAL')}
          onChange={(c) =>
            props.onPatch({ textCase: c as Patch['textCase'] }, false)
          }
        >
          <Show when={isMixed('case')}>
            <option value="mixed" selected disabled>
              Mixed
            </option>
          </Show>
          <For each={CASES}>
            {([value, label]) => (
              <option
                value={value}
                selected={
                  !isMixed('case') && value === (t().case ?? 'ORIGINAL')
                }
              >
                {label}
              </option>
            )}
          </For>
        </Select>
      </div>
    </div>
  );
}
