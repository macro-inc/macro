/**
 * @file Simple language query utilities for create.ts and chat usage
 *
 * This module provides unified query functions that work across both
 * block-code (Monaco editor) and lexical-core (markdown blocks) language support.
 */

import {
  langAliasesToFileExtension as blockCodeAliases,
  isExtensionSupported as blockCodeExtensionSupported,
  supportedExtensions as blockCodeSupportedExtensions,
  langIdSet,
} from '@block-code/util/languageSupport';
import {
  langAliasesToFileExtension as lexicalAliases,
  isExtensionSupported as lexicalExtensionSupported,
  isSupportedLanguage as lexicalLanguageSupported,
  supportedExtensions as lexicalSupportedExtensions,
} from '@lexical-core/utils';

/**
 * Check if an extension is supported by block-code.
 */
export function isCodeEditorExtensionSupported(extension: string): boolean {
  return blockCodeExtensionSupported(extension);
}

/**
 * Check if an extension is supported by markdown code-boxes.
 */
export function isMarkdownExtensionSupported(extension: string): boolean {
  return lexicalExtensionSupported(extension);
}

/**
 * Check if an language is supported by block-code.
 */
export function isCodeEditorLanguageSupported(language: string): boolean {
  return langIdSet.has(language.toLowerCase());
}

/**
 * Check if a language is supported by markdown code-boxes.
 */
export function isMarkdownLanguageSupported(language: string): boolean {
  return lexicalLanguageSupported(language);
}

/**
 * Get the best supported file extension for a language
 * Prioritizes code editor support, falls back to markdown support
 */
export function getExtensionForLanguage(language: string): string | null {
  const lowerLang = language.toLowerCase();

  // First try code editor registry
  if (langIdSet.has(lowerLang) && blockCodeAliases[lowerLang]) {
    return blockCodeAliases[lowerLang];
  }

  // Fall back to lexical support
  if (lexicalAliases[lowerLang]) {
    return lexicalAliases[lowerLang];
  }

  return null;
}

export const allSupportedExtensionSet = new Set([
  ...blockCodeSupportedExtensions,
  ...lexicalSupportedExtensions,
]);
