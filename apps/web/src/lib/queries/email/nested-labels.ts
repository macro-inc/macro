export type NestedLabel<Label> = {
  label: Label;
  /** The label's own name, after its parents: "Larkspur". */
  leaf: string;
  /** Its parents' names and its own, outermost first. */
  path: string[];
};

/**
 * One inbox's labels as a tree, flattened with each parent right before its
 * children. Gmail writes nesting into the name ("Customers/Larkspur") and nests
 * only under a label that exists; a slash in an Outlook category is just a slash.
 */
export function nestLabels<Label extends { name: string }>(
  labels: readonly Label[],
  provider: 'GMAIL' | 'OUTLOOK'
): NestedLabel<Label>[] {
  const names = new Set(labels.map((label) => label.name));

  const pathOf = (name: string): string[] => {
    if (provider !== 'GMAIL') return [name];
    let slash = name.lastIndexOf('/');
    while (slash > 0) {
      const parent = name.slice(0, slash);
      if (names.has(parent)) return [...pathOf(parent), name.slice(slash + 1)];
      slash = name.lastIndexOf('/', slash - 1);
    }
    return [name];
  };

  return labels
    .map((label) => {
      const path = pathOf(label.name);
      return { label, leaf: path.at(-1) ?? label.name, path };
    })
    .sort((left, right) => comparePaths(left.path, right.path));
}

/** A label's whole name in words: "Customers / Larkspur". */
export function formatLabelPath(path: readonly string[]): string {
  return path.join(' / ');
}

function comparePaths(left: readonly string[], right: readonly string[]) {
  const shared = Math.min(left.length, right.length);
  for (let depth = 0; depth < shared; depth++) {
    const order = left[depth].localeCompare(right[depth]);
    if (order !== 0) return order;
  }
  return left.length - right.length;
}
