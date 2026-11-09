/** Escape names change runtime resolution, never the canonical declaration identity. */
export function declarationSpecifier(specifier: string) {
  const prefix = 'lexical-upstream:';
  if (!specifier.startsWith(prefix)) return specifier;
  const original = specifier.slice(prefix.length);
  if (original !== 'lexical' && !original.startsWith('@lexical/'))
    throw new Error('Invalid upstream declaration escape: ' + specifier);
  return original;
}
import type ts from 'typescript';

export function declarationOptions(
  specifier: string,
  containingFile: string,
  options: ts.CompilerOptions
): ts.CompilerOptions {
  const original = declarationSpecifier(specifier);
  const upstreamGraph =
    /\/node_modules\/(?:lexical|@lexical\/[^/]+)\//.test(containingFile) &&
    (original === 'lexical' || original.startsWith('@lexical/'));
  if (original === specifier && !upstreamGraph) return options;
  const canonical = { ...options };
  delete canonical.paths;
  delete canonical.baseUrl;
  delete canonical.pathsBasePath;
  return canonical;
}
