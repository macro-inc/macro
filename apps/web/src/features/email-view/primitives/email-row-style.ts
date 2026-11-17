import { usePreference } from '@app/lib/preferences/use-preference';
import type { EmailRowStyle } from '@entity';

/** A saved value this build doesn't know reads as the default, Minimalist. */
export function parseEmailRowStyle(value: unknown): EmailRowStyle {
  return value === 'classic' ? 'classic' : 'minimalist';
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

export const emailRowStyle = (): EmailRowStyle =>
  parseEmailRowStyle(storedEmailRowStyle());

export function setEmailRowStyle(style: EmailRowStyle) {
  setStoredEmailRowStyle(style);
}
