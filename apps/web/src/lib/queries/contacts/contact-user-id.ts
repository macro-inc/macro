import { type MacroId, macroIdToEmail, tryMacroId } from '@core/user/macroId';
import { validate as validEmail } from 'email-validator';

const UTF8 = new TextEncoder();
export const MAX_CONTACT_ID_BYTES = 1024;

/** Admit supported Macro identities, not every address accepted by email entry.
 * The Rust parser excludes '$' local parts; external addresses remain valid email recipients. */
export function canonicalContactUserId(value: string): MacroId | undefined {
  if (value.length > MAX_CONTACT_ID_BYTES) return;
  const id = tryMacroId(value.toLowerCase());
  return id &&
    !id.includes('$') &&
    UTF8.encode(id).length <= MAX_CONTACT_ID_BYTES &&
    validEmail(macroIdToEmail(id))
    ? id
    : undefined;
}
