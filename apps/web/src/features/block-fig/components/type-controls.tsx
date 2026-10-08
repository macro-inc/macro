import { InspectorSelect } from './inspector-select';
/**
 * The editable Type section: family, weight and italic, size, line height,
 * letter spacing and alignment, with less-used controls in Type settings. With characters selected in
 * the text editor it shows (and sets) theirs, "Mixed" where they differ.
 * Presentational.
 */

import type { TextInfo } from '@core/fig-engine/types';
import AlignBottomSimple from '@phosphor/align-bottom-simple.svg';
import AlignCenterVerticalSimple from '@phosphor/align-center-vertical-simple.svg';
import AlignTopSimple from '@phosphor/align-top-simple.svg';
import TextAlignCenter from '@phosphor/text-align-center.svg';
import TextAlignJustify from '@phosphor/text-align-justify.svg';
import TextAlignLeft from '@phosphor/text-align-left.svg';
import TextAlignRight from '@phosphor/text-align-right.svg';

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
import { TypeSettings } from './type-settings';

const H_ALIGN = [
  {
    value: 'LEFT',
    label: 'Align left',
    icon: <TextAlignLeft class="size-3.5" />,
  },
  {
    value: 'CENTER',
    label: 'Align center',
    icon: <TextAlignCenter class="size-3.5" />,
  },
  {
    value: 'RIGHT',
    label: 'Align right',
    icon: <TextAlignRight class="size-3.5" />,
  },
  {
    value: 'JUSTIFIED',
    label: 'Justify',
    icon: <TextAlignJustify class="size-3.5" />,
  },
] as const;

const V_ALIGN = [
  {
    value: 'TOP',
    label: 'Align top',
    icon: <AlignTopSimple class="size-3.5" />,
  },
  {
    value: 'CENTER',
    label: 'Align middle',
    icon: <AlignCenterVerticalSimple class="size-3.5" />,
  },
  {
    value: 'BOTTOM',
    label: 'Align bottom',
    icon: <AlignBottomSimple class="size-3.5" />,
  },
] as const;

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
  let settingsAnchor: HTMLDivElement | undefined;
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
      <div class="grid grid-cols-2 gap-2">
        <InspectorSelect
          label="Weight"
          testId="fig-font-weight"
          value={isMixed('fontStyle') ? 'mixed' : String(style().weight)}
          options={[
            ...(isMixed('fontStyle')
              ? [{ value: 'mixed', label: 'Mixed', disabled: true }]
              : []),
            ...weights().map(([weight, label]) => ({
              value: String(weight),
              label,
            })),
          ]}
          onChange={(value) =>
            props.onPatch(
              { fontStyle: styleName(Number(value), style().italic) },
              false
            )
          }
        />
        <NumberField
          label="T"
          ariaLabel="Font size"
          value={t().fontSize ?? 12}
          mixed={isMixed('fontSize')}
          min={1}
          testId="fig-field-font-size"
          onChange={(fontSize, live) => props.onPatch({ fontSize }, live)}
        />
      </div>
      <div class="grid grid-cols-2 gap-2">
        <span class="text-ink-muted text-[11px]">Line height</span>
        <span class="text-ink-muted text-[11px]">Letter spacing</span>
        <ParsedField
          label="↕"
          ariaLabel="Line height"
          shown={
            isMixed('lineHeight') ? 'Mixed' : formatLineHeight(t().lineHeight)
          }
          parse={parseLineHeight}
          testId="fig-field-line-height"
          onChange={(lineHeight) => props.onPatch({ lineHeight }, false)}
        />
        <ParsedField
          label="↔"
          ariaLabel="Letter spacing"
          shown={
            isMixed('letterSpacing')
              ? 'Mixed'
              : formatLetterSpacing(t().letterSpacing)
          }
          parse={parseLetterSpacing}
          testId="fig-field-letter-spacing"
          onChange={(letterSpacing) => props.onPatch({ letterSpacing }, false)}
        />
      </div>
      <div ref={settingsAnchor} class="flex items-center justify-between">
        <span class="text-ink-muted text-[11px]">Alignment</span>
        <TypeSettings
          anchor={() => settingsAnchor}
          text={t()}
          mixed={props.mixed}
          onPatch={props.onPatch}
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
    </div>
  );
}
