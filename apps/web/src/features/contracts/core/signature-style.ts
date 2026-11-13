import type { SignatureStyle } from './packet';

/** Ink for marks on a PDF page, which is white in every theme. */
export const SIGNATURE_INK = '#14213d';

const FAMILIES: Record<SignatureStyle, string> = {
  'script-1': "'Snell Roundhand', 'Segoe Script', 'Brush Script MT', cursive",
  'script-2':
    "'Brush Script MT', 'Lucida Handwriting', 'Apple Chancery', cursive",
  'script-3': "'Apple Chancery', 'Lucida Handwriting', 'Segoe Script', cursive",
};

/**
 * Cursive faces already on people's devices. Each style prefers a different
 * one and falls back to the platform's generic script.
 */
export function signatureFontFamily(style: SignatureStyle): string {
  return FAMILIES[style];
}
