import type { JSX } from 'solid-js';
import type { DatabaseColor } from '../core/database';
import type { Packet } from '../core/packet';
import { signingPosition } from '../core/routing';

/** Hues that tell signers apart on the page, in signing order. */
const SIGNER_TONES = ['blue', 'orange', 'violet', 'teal', 'pink'] as const;
export type Tone = (typeof SIGNER_TONES)[number] | 'neutral';

/** The hue of a recipient: one per signer, neutral for copy recipients. */
export function recipientTone(
  packet: Pick<Packet, 'recipients'>,
  recipientId: string
): Tone {
  const position = signingPosition(packet, recipientId);
  if (position === undefined) return 'neutral';
  return SIGNER_TONES[(position - 1) % SIGNER_TONES.length];
}

/**
 * CSS variables for a tone, so one set of classes (`bg-(--tone-bg)`,
 * `border-(--tone)`, `text-(--tone-ink)`) paints any recipient. `--tone-print`
 * is the tone darkened for text on a PDF page, which is white in every theme.
 */
export function toneVars(tone: Tone | DatabaseColor): JSX.CSSProperties {
  if (tone === 'neutral') {
    return {
      '--tone': 'var(--color-ink-extra-muted)',
      '--tone-bg': 'var(--color-hover)',
      '--tone-ink': 'var(--color-ink-muted)',
      '--tone-print': '#555555',
    };
  }
  return {
    '--tone': `var(--color-${tone})`,
    '--tone-bg': `var(--color-${tone}-bg)`,
    '--tone-ink': `var(--color-${tone}-ink)`,
    '--tone-print': `color-mix(in oklch, var(--color-${tone}) 55%, black)`,
  };
}
