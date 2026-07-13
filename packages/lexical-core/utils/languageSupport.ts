/**
 * @file Language support for lexical-core (markdown blocks)
 *
 * This module defines languages supported for syntax highlighting in markdown code blocks.
 * It maintains a similar structure to block-code/util/languageSupport.ts for consistency.
 */

import { getCodeLanguages } from '@lexical/code';

export const SupportedLanguages = [
  'plaintext',
  'javascript',
  'typescript',
  'json',
  'python',
  'rust',
  'java',
  'swift',
  'c',
  'cpp',
  'css',
  'html',
  'markdown',
  'powershell',
  'sql',
  'bash',
  'svg',
] as const;

export type SupportedLanguage = (typeof SupportedLanguages)[number];

export const DEFAULT_LANGUAGE: SupportedLanguage = 'plaintext';

/**
 * A language definition for the syntax-highlighted code box.
 * @prop label - The official and correctly spelled and capitalized name of the language
 * @prop show - Whether or not to show the language in our language selector menus.
 * @prop aliases - An array of aliases for the language. This is useful for when we want parse
 *     markdown files with un-normalized names for a language.
 */
export type LanguageDefinition = {
  label: string;
  show: boolean;
  aliases?: string[];
  highlightsEnabled?: boolean;
};

/**
 * The supported language options for our lexical code plugin.
 */
export const LanguageDefinitions: Record<
  SupportedLanguage,
  LanguageDefinition
> = {
  plaintext: {
    label: 'Plain Text',
    show: true,
    aliases: ['text'],
  },
  javascript: {
    label: 'JavaScript',
    show: true,
    aliases: ['js', 'jsx', 'java script'],
    highlightsEnabled: true,
  },
  typescript: {
    label: 'TypeScript',
    show: true,
    aliases: ['ts', 'tsx', 'type script'],
    highlightsEnabled: true,
  },
  json: {
    label: 'JSON',
    show: true,
    highlightsEnabled: true,
  },
  python: {
    label: 'Python',
    show: true,
    aliases: ['py'],
    highlightsEnabled: true,
  },
  rust: {
    label: 'Rust',
    show: true,
    aliases: ['rs'],
    highlightsEnabled: true,
  },
  java: {
    label: 'Java',
    show: true,
    highlightsEnabled: true,
  },
  swift: {
    label: 'Swift',
    show: true,
    highlightsEnabled: true,
  },
  c: {
    label: 'C',
    show: true,
    highlightsEnabled: true,
  },
  cpp: {
    label: 'C++',
    show: true,
    aliases: ['c++'],
    highlightsEnabled: true,
  },
  css: {
    label: 'CSS',
    show: true,
    highlightsEnabled: true,
  },
  html: {
    label: 'HTML',
    show: true,
    highlightsEnabled: true,
  },
  markdown: {
    label: 'Markdown',
    show: true,
    aliases: ['md'],
    highlightsEnabled: true,
  },
  powershell: {
    label: 'Shell',
    show: true,
    aliases: ['sh'],
    highlightsEnabled: true,
  },
  sql: {
    label: 'SQL',
    show: true,
    highlightsEnabled: true,
  },
  bash: {
    label: 'Bash',
    show: true,
    highlightsEnabled: true,
  },
  svg: {
    label: 'SVG',
    show: true,
    aliases: ['xml'],
    highlightsEnabled: true,
  },
} as const;

// Pre-computed lookup maps for performance
const _normalizedLanguageLookup: Record<string, SupportedLanguage> = {};
const _highlightedLanguages = new Set(getCodeLanguages());

// Initialize lookup maps
for (const [language, definition] of Object.entries(LanguageDefinitions)) {
  const lang = language as SupportedLanguage;

  // Set highlightsEnabled based on Prism support
  if (_highlightedLanguages.has(language)) {
    definition.highlightsEnabled = true;
  }

  // Map language name itself
  _normalizedLanguageLookup[definition.label.toLowerCase()] = lang;
  _normalizedLanguageLookup[lang.toLowerCase()] = lang;

  // Map aliases
  for (const alias of definition.aliases ?? []) {
    _normalizedLanguageLookup[alias.toLowerCase()] = lang;
  }
}

// File extension to language mapping for markdown blocks
const fileExtensionToMdSupportedLanguage: Record<string, SupportedLanguage> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  cts: 'typescript',
  mts: 'typescript',
  json: 'json',
  jsonc: 'json',
  py: 'python',
  pyw: 'python',
  pyi: 'python',
  rpy: 'python',
  rs: 'rust',
  java: 'java',
  jav: 'java',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  'c++': 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  'h++': 'cpp',
  css: 'css',
  scss: 'css',
  sass: 'css',
  less: 'css',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  shtml: 'html',
  md: 'markdown',
  markdown: 'markdown',
  ps1: 'powershell',
  psd1: 'powershell',
  psm1: 'powershell',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  svg: 'svg',
  xml: 'svg',
};

// Language aliases to file extensions (for create.ts compatibility)
export const langAliasesToFileExtension: Record<string, string> = {
  // Core languages
  plaintext: 'txt',
  text: 'txt',
  javascript: 'js',
  js: 'js',
  jsx: 'jsx',
  'javascript jsx': 'jsx',
  'javascript react': 'jsx',
  typescript: 'ts',
  ts: 'ts',
  tsx: 'tsx',
  'typescript jsx': 'tsx',
  'typescript react': 'tsx',
  json: 'json',
  python: 'py',
  py: 'py',
  rust: 'rs',
  rs: 'rs',
  java: 'java',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  'c++': 'cpp',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  html: 'html',
  htm: 'html',
  markdown: 'md',
  md: 'md',
  powershell: 'ps1',
  ps: 'ps1',
  ps1: 'ps1',
  shell: 'sh',
  sh: 'sh',
  bash: 'sh',
  sql: 'sql',
  svg: 'svg',
  xml: 'svg',
};

export const supportedLanguageSet = new Set(SupportedLanguages);
export const supportedExtensions = Object.keys(
  fileExtensionToMdSupportedLanguage
);

export function isSupportedLanguage(
  language: string
): language is SupportedLanguage {
  const languageLC = language.toLowerCase();
  return languageLC in _normalizedLanguageLookup;
}

export function normalizedLanguage(language: string): SupportedLanguage {
  const languageLC = language.toLowerCase();
  return _normalizedLanguageLookup[languageLC] || DEFAULT_LANGUAGE;
}

export function isNormalizedLanguage(language: string): boolean {
  return language in LanguageDefinitions;
}

export function getSupportedLanguageFromFileExtension(
  extension?: string | null
): SupportedLanguage {
  if (!extension) return DEFAULT_LANGUAGE;
  const normalized = extension.toLowerCase().replace(/^\./, '');
  return fileExtensionToMdSupportedLanguage[normalized] ?? DEFAULT_LANGUAGE;
}

export function detectLanguageFromExtension(
  fileExtension: string
): string | null {
  const normalizedExt = fileExtension.toLowerCase().replace(/^\./, '');
  return fileExtensionToMdSupportedLanguage[normalizedExt] || null;
}

export function isExtensionSupported(fileExtension: string): boolean {
  const normalizedExt = fileExtension.toLowerCase().replace(/^\./, '');
  return normalizedExt in fileExtensionToMdSupportedLanguage;
}

export function getSupportedExtensions(): string[] {
  return Object.keys(fileExtensionToMdSupportedLanguage);
}

export function getLanguageLabel(language: string): string {
  const lang = normalizedLanguage(language);
  return LanguageDefinitions[lang].label;
}

export function getSelectableLanguages(): LanguageDefinition[] {
  return Object.values(LanguageDefinitions)
    .filter((def) => def.show)
    .sort((a, b) => a.label.localeCompare(b.label));
}
