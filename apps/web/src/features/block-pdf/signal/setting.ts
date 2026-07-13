import { makePersisted } from '@solid-primitives/storage';
import { createEffect, createSignal } from 'solid-js';
import { type HSL, hslToString } from '../util/hslToString';

export enum ColorStorageKeys {
  TermColor = '--TERM_OVERLAY_COLOR',
  SectionColor = '--SECTION_OVERLAY_COLOR',
  SrefColor = '--SREF_OVERLAY_COLOR',
  TrefColor = '--TREF_OVERLAY_COLOR',
}

function createPersistentColorSignal(key: ColorStorageKeys) {
  const defaultValue: HSL = colorMap[key];
  const [value, setValue] = makePersisted(createSignal<HSL>(defaultValue), {
    name: key,
  });

  const update = (newValue: HSL | 'reset' | ((prev: HSL) => HSL)) => {
    if (newValue === 'reset') {
      setValue(defaultValue);
    } else {
      setValue(newValue);
    }
  };

  return [value, update] as const;
}

export type ColorSignal = ReturnType<typeof createPersistentColorSignal>;

const termColorDefault: HSL = {
  h: 219,
  s: 0.78,
  l: 0.36,
  a: 1,
};

const sectionColorDefault: HSL = {
  h: 4.1052,
  s: 0.8962,
  l: 0.5843,
  a: 0,
};

const trefColorDefault: HSL = {
  h: 219,
  s: 0.78,
  l: 0.36,
  a: 1,
};

const srefColorDefault: HSL = {
  h: 122.4242,
  s: 0.3944,
  l: 0.4921,
  a: 1,
};

const colorMap: Record<ColorStorageKeys, HSL> = {
  [ColorStorageKeys.TermColor]: termColorDefault,
  [ColorStorageKeys.SectionColor]: sectionColorDefault,
  [ColorStorageKeys.SrefColor]: srefColorDefault,
  [ColorStorageKeys.TrefColor]: trefColorDefault,
};

export const colorSignalMap = Object.fromEntries(
  Object.keys(colorMap).map((key) => [
    key,
    createPersistentColorSignal(key as ColorStorageKeys),
  ])
) as Record<ColorStorageKeys, ReturnType<typeof createPersistentColorSignal>>;

const getRoot = () => document.querySelector(':root') as HTMLElement;

function updateColorEffect(key: ColorStorageKeys) {
  const [value] = colorSignalMap[key];

  createEffect(() => {
    const val = value();
    const hoverKey = key.replace('_COLOR', '_HOVER_COLOR');

    const { h, s, a } = val;
    let newL = val.l;

    if (val.l * 100 > 20) {
      newL -= 20 / 100;
    } else {
      newL += 20 / 100;
    }

    const displayKey = key.replace('_COLOR', '_DISPLAY');
    const displayProp = a ? 'block' : 'none';

    const root = getRoot();
    root.style?.setProperty(key, hslToString(val));
    root.style?.setProperty(hoverKey, hslToString({ h, s, l: newL, a }));
    root.style?.setProperty(displayKey, displayProp);
  });
}

/**
 * Batch the above hook into a single hook for all colors
 */
export function useUpdateColorsEffect() {
  updateColorEffect(ColorStorageKeys.SrefColor);
  updateColorEffect(ColorStorageKeys.TrefColor);
  updateColorEffect(ColorStorageKeys.SectionColor);
  updateColorEffect(ColorStorageKeys.TermColor);
}

function resetColor(key: ColorStorageKeys) {
  const [, update] = colorSignalMap[key];
  update('reset');
}
/**
 * Reset the colours of the terms, sections, ref, etc, to their default
 */
export function resetColors() {
  resetColor(ColorStorageKeys.TermColor);
  resetColor(ColorStorageKeys.TrefColor);
  resetColor(ColorStorageKeys.SectionColor);
  resetColor(ColorStorageKeys.SrefColor);
}
