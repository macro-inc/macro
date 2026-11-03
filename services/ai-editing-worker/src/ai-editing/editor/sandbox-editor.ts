import {
  DocumentEditor,
  type DocumentEditorOptions,
} from '@macro-inc/editor-ops/document';

function editorMethodNames(target: DocumentEditor): string[] {
  const names = new Set<string>();
  for (
    let proto = target;
    proto && proto !== Object.prototype;
    proto = Object.getPrototypeOf(proto)
  ) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === 'constructor' || key.startsWith('_')) continue;
      if (typeof target[key as keyof DocumentEditor] === 'function') {
        names.add(key);
      }
    }
  }
  return [...names];
}

function suggestMethods(wanted: string, names: string[]): string[] {
  const normalizedWanted = wanted.toLowerCase();
  const scored = names.map((name) => {
    const normalizedName = name.toLowerCase();
    let score = 0;
    if (normalizedName === normalizedWanted) score = 1000;
    else if (
      normalizedName.includes(normalizedWanted) ||
      normalizedWanted.includes(normalizedName)
    ) {
      score = 100 + Math.min(normalizedName.length, normalizedWanted.length);
    } else {
      while (
        score < normalizedName.length &&
        score < normalizedWanted.length &&
        normalizedName[score] === normalizedWanted[score]
      ) {
        score++;
      }
    }
    return { name, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored
    .filter(({ score }) => score >= 3)
    .slice(0, 3)
    .map(({ name }) => name);
}

/** Create the write-only editor exposed to generated sandbox snippets; unknown methods throw with suggestions. */
export function createDocumentEditor(
  options: DocumentEditorOptions
): DocumentEditor {
  const target = new DocumentEditor(options);
  return new Proxy(target, {
    get(editor, property) {
      const value = editor[property as keyof DocumentEditor];
      if (value !== undefined || typeof property !== 'string') {
        return typeof value === 'function' ? value.bind(editor) : value;
      }
      return () => {
        const suggestions = suggestMethods(property, editorMethodNames(editor));
        throw new Error(
          `editor.${property} does not exist` +
            (suggestions.length
              ? `. Did you mean: ${suggestions.join(', ')}?`
              : '.') +
            ' The editor is write-only — to inspect the document use the readDocument tool, not a call inside the snippet.'
        );
      };
    },
  });
}
