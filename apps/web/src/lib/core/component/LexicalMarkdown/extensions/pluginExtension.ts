import type { AnyLexicalExtension } from 'lexical';
import { defineExtension } from 'lexical';
import type { PluginFunction } from '../plugins/pluginManager';

/**
 * Adapt an existing Lexical registration callback into an independently named
 * extension. This keeps the callback implementation while giving Lexical's
 * extension graph ownership of registration and disposal.
 */
export function pluginExtension(
  name: string,
  register: PluginFunction
): AnyLexicalExtension {
  return defineExtension({
    name: `@macro-inc/lexical/${name}`,
    register: (editor) => register(editor),
  });
}
