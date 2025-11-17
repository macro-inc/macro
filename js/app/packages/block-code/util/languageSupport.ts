import type { Extension } from '@codemirror/state';
import { FileTypeMap } from '@service-storage/fileTypeMap';

type LanguageLoader = () => Promise<Extension>;

const languageLoaders: Record<string, LanguageLoader> = {
  javascript: async () => {
    const { javascript } = await import('@codemirror/lang-javascript');
    return javascript({ jsx: false, typescript: false });
  },

  typescript: async () => {
    const { javascript } = await import('@codemirror/lang-javascript');
    return javascript({ jsx: false, typescript: true });
  },

  jsx: async () => {
    const { javascript } = await import('@codemirror/lang-javascript');
    return javascript({ jsx: true, typescript: false });
  },

  tsx: async () => {
    const { javascript } = await import('@codemirror/lang-javascript');
    return javascript({ jsx: true, typescript: true });
  },

  html: async () => {
    const { html } = await import('@codemirror/lang-html');
    return html();
  },

  css: async () => {
    const { css } = await import('@codemirror/lang-css');
    return css();
  },

  json: async () => {
    const { json } = await import('@codemirror/lang-json');
    return json();
  },

  python: async () => {
    const { python } = await import('@codemirror/lang-python');
    return python();
  },

  rust: async () => {
    const { rust } = await import('@codemirror/lang-rust');
    return rust();
  },

  cpp: async () => {
    const { cpp } = await import('@codemirror/lang-cpp');
    return cpp();
  },

  c: async () => {
    const { cpp } = await import('@codemirror/lang-cpp');
    return cpp();
  },

  plaintext: async () => {
    return [];
  },
};

const extensionToLanguage: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  cts: 'typescript',
  mts: 'typescript',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  shtml: 'html',
  css: 'css',
  scss: 'css',
  sass: 'css',
  less: 'css',
  json: 'json',
  jsonc: 'json',
  py: 'python',
  pyw: 'python',
  pyi: 'python',
  rpy: 'python',
  rs: 'rust',
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
  ii: 'cpp',
  ino: 'cpp',
  inl: 'cpp',
  ipp: 'cpp',
  ixx: 'cpp',
  cppm: 'cpp',
  ccm: 'cpp',
  cxxm: 'cpp',
  'c++m': 'cpp',
  txt: 'plaintext',
  csv: 'plaintext',
};

// Build supported extensions from FileTypeMap where app === 'code'
const codeFileExtensions = Object.values(FileTypeMap)
  .filter((fileType) => fileType.app === 'code')
  .map((fileType) => fileType.extension);

export type CodeFileExtension = (typeof codeFileExtensions)[number];

// Combine with our explicitly mapped extensions
const allSupportedExtensions = [
  ...new Set([...Object.keys(extensionToLanguage), ...codeFileExtensions]),
];

// Supported languages (source of truth for block-code)
export const supportedLanguages = Object.keys(languageLoaders);
export const supportedLanguageSet = new Set(supportedLanguages);

// Supported file extensions (derived from FileTypeMap)
export const supportedExtensions = allSupportedExtensions;
export const supportedExtensionSet = new Set(supportedExtensions);

// Language aliases to file extensions (for create.ts compatibility)
export const langAliasesToFileExtension: Record<string, string> = {
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
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'css',
  sass: 'sass',
  less: 'less',
  json: 'json',
  jsonc: 'jsonc',
  python: 'py',
  py: 'py',
  rust: 'rs',
  rs: 'rs',
  c: 'c',
  cpp: 'cpp',
  'c++': 'cpp',
};

// Language set for compatibility
export const langIdSet = new Set([
  ...supportedLanguages,
  ...Object.keys(langAliasesToFileExtension),
]);

// Export supported languages as langId for compatibility
export const langId = supportedLanguages;

export function detectLanguageFromExtension(
  fileExtension: string
): string | null {
  const normalizedExt = fileExtension.toLowerCase().replace(/^\./, '');

  // Check if we have an explicit language mapping
  if (extensionToLanguage[normalizedExt]) {
    return extensionToLanguage[normalizedExt];
  }

  // Return plaintext as fallback for code files without explicit language mapping
  const matchesCodeFileType = codeFileExtensions.includes(normalizedExt as any);
  if (matchesCodeFileType) {
    return 'plaintext';
  }

  return null;
}

export async function loadLanguageExtension(
  language: string
): Promise<Extension | null> {
  const loader = languageLoaders[language];
  if (!loader) {
    return null;
  }
  try {
    return await loader();
  } catch (error) {
    console.warn(`Failed to load language extension for ${language}:`, error);
    return null;
  }
}

export async function loadLanguageExtensionWithFallback(
  language: string
): Promise<Extension> {
  const extension = await loadLanguageExtension(language);
  if (extension) {
    return extension;
  }

  // Fallback to JavaScript for unsupported languages
  console.info(
    `Language '${language}' not supported, falling back to JavaScript`
  );
  return languageLoaders.javascript();
}

export async function loadLanguageFromExtensionWithFallback(
  fileExtension: string
): Promise<Extension> {
  const language = detectLanguageFromExtension(fileExtension);
  if (!language) {
    console.info(
      `File extension '${fileExtension}' not recognized, using JavaScript`
    );
    return languageLoaders.javascript();
  }
  return loadLanguageExtensionWithFallback(language);
}

export function getSupportedExtensions(): string[] {
  return Object.keys(extensionToLanguage);
}

export function isExtensionSupported(fileExtension: string): boolean {
  const normalizedExt = fileExtension.toLowerCase().replace(/^\./, '');
  return normalizedExt in extensionToLanguage;
}
