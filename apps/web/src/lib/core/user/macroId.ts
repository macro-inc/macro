/**
 * Branded type for MacroId strings.
 * Format: `macro|email@domain.com`
 */
declare const MacroIdBrand: unique symbol;
export type MacroId = string & { readonly [MacroIdBrand]: never };

/**
 * Type guard to check if a string is a valid MacroId.
 */
function isMacroId(str: string): str is MacroId {
  return str.startsWith('macro|') && str.slice(6).includes('@');
}

/**
 * Attempts to parse a string as a MacroId.
 * Returns the MacroId if valid, undefined otherwise.
 */
export function tryMacroId(str: string): MacroId | undefined {
  return isMacroId(str) ? str : undefined;
}

/**
 * Extracts the email from a MacroId.
 */
export function macroIdToEmail(id: MacroId): string {
  return id.slice(6);
}

/**
 * Creates a MacroId from an email address.
 * Returns undefined if the email is invalid.
 */
export function emailToMacroId(email: string): MacroId | undefined {
  if (!email.includes('@')) {
    return undefined;
  }
  return `macro|${email}` as MacroId;
}
