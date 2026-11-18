import { usePreference } from '@app/lib/preferences/use-preference';
import { isMobile } from '@core/mobile/isMobile';
import type { EmailRowStyle } from '@entity';

/** A saved value this build doesn't know reads as the default, Minimalist. */
export function parseEmailRowStyle(value: unknown): EmailRowStyle {
  return value === 'classic' ? 'classic' : 'minimalist';
}

/** Phones always show Minimalist rows; the choice applies to tablets and desktop. */
export function rowStyleForDevice(style: EmailRowStyle): EmailRowStyle {
  return isMobile() ? 'minimalist' : style;
}

/**
 * How Mail rows look, chosen in Settings → Email. It is the reader's
 * preference on this device, like the reading pane. One module-level signal
 * keeps every open Mail list in step with the settings page.
 */
const [storedEmailRowStyle, setStoredEmailRowStyle] = usePreference<string>(
  'macro:pref:email:row-style',
  { default: 'minimalist' }
);

/** The style chosen in Settings. */
export const chosenEmailRowStyle = (): EmailRowStyle =>
  parseEmailRowStyle(storedEmailRowStyle());

/** The style Mail rows use on this device. */
export const emailRowStyle = (): EmailRowStyle =>
  rowStyleForDevice(chosenEmailRowStyle());

export function setEmailRowStyle(style: EmailRowStyle) {
  setStoredEmailRowStyle(style);
}
