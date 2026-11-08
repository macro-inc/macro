import ts from 'typescript';

type Range = { startOffset: number; endOffset: number; count: number };
type Region<T> = {
  start: number;
  end: number;
  body: number;
  points: T[];
};

/** Keep parent counters from claiming a child omitted by V8's lazy coverage. */
export class FunctionCoverage<T extends { offset: number }> {
  private regions: Region<T>[] = [];
  private ends = new Map<number, Region<T>[]>();
  private program: T[] = [];
  private length: number;

  constructor(source: string, points: T[]) {
    this.length = source.length;
    const file = ts.createSourceFile(
      'coverage.js',
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS
    );
    const visit = (node: ts.Node): void => {
      let body: ts.Node | undefined;
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node) ||
        ts.isConstructorDeclaration(node)
      ) {
        body = node.body;
      } else if (ts.isPropertyDeclaration(node)) {
        body = node.initializer ?? node.name;
      } else if (ts.isClassStaticBlockDeclaration(node)) {
        body = node.body;
      }
      if (body) {
        const region: Region<T> = {
          start: node.getStart(file),
          end: node.end,
          body: body.getStart(file),
          points: [],
        };
        this.regions.push(region);
        const siblings = this.ends.get(region.end) ?? [];
        siblings.push(region);
        this.ends.set(region.end, siblings);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    this.regions.sort((a, b) => a.end - a.start - (b.end - b.start));
    for (const point of points) {
      const owner = this.regions.find(
        (region) => region.start <= point.offset && point.offset < region.end
      );
      (owner?.points ?? this.program).push(point);
    }
  }

  covered(
    functions: { functionName?: string; ranges: Range[] }[],
    select: (points: T[], ranges: Range[]) => T[]
  ): T[] {
    const output: T[] = [];
    for (const fn of functions) {
      const root = fn.ranges[0];
      if (!root) continue;
      if (
        fn.functionName === '' &&
        root.startOffset === 0 &&
        root.endOffset === this.length
      ) {
        output.push(...select(this.program, fn.ranges));
        continue;
      }
      const owner = this.ends
        .get(root.endOffset)
        ?.filter(
          (region) =>
            region.start <= root.startOffset && root.startOffset <= region.body
        )
        .sort(
          (a, b) =>
            Math.abs(a.start - root.startOffset) -
            Math.abs(b.start - root.startOffset)
        )[0];
      const points = owner?.points ?? [];
      output.push(...select(points, fn.ranges));
    }
    return output;
  }
}

type Hunk = {
  start: number;
  end: number;
  delta: number;
  lines: Map<number, number>;
};

/** Source maps describe patched files; S2 citations describe the pristine pin. */
export class PatchLines {
  private files = new Map<string, Hunk[]>();

  constructor(patch: string) {
    let file: Hunk[] = [];
    let hunk: Hunk | undefined;
    let original = 0;
    let modified = 0;
    for (const line of patch.split('\n')) {
      if (line.startsWith('+++ b/')) {
        file = this.files.get(line.slice(6)) ?? [];
        this.files.set(line.slice(6), file);
        hunk = undefined;
        continue;
      }
      const header = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (header) {
        original = Number(header[1]);
        modified = Number(header[3]);
        const end = modified + Number(header[4] ?? 1);
        hunk = {
          start: modified,
          end,
          delta: end - original - Number(header[2] ?? 1),
          lines: new Map(),
        };
        file.push(hunk);
      } else if (hunk && line.startsWith(' ')) {
        hunk.lines.set(modified++, original++);
      } else if (hunk && line.startsWith('+')) {
        modified++;
      } else if (hunk && line.startsWith('-')) {
        original++;
      }
    }
  }

  original(file: string, line: number): number | undefined {
    let delta = 0;
    for (const hunk of this.files.get(file) ?? []) {
      if (line < hunk.start) break;
      if (line < hunk.end) return hunk.lines.get(line);
      delta = hunk.delta;
    }
    return line - delta;
  }
}
