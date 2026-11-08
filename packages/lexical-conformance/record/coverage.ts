import { readFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { eachMapping, TraceMap } from '@jridgewell/trace-mapping';
import { FunctionCoverage, PatchLines } from './coverage-map';

type Range = { startOffset: number; endOffset: number; count: number };
type Point = { offset: number; file: string; line: number };
type Location = { file: string; start: number; end: number; id: string };
const locations: Location[] = JSON.parse(
  readFileSync(new NodeURL('./s2-ranges.json', import.meta.url), 'utf8')
);
const patchLines = new PatchLines(
  readFileSync(new NodeURL('./hooks.patch', import.meta.url), 'utf8')
);

/** Select the most specific V8 range, retaining zero-count branch exclusions. */
export function coveredPoints<T extends { offset: number }>(
  points: T[],
  input: Range[]
): T[] {
  const priority = (
    a: Range & { order: number },
    b: Range & { order: number }
  ) =>
    a.endOffset - a.startOffset - (b.endOffset - b.startOffset) ||
    a.order - b.order;
  const ranges = input
    .map((range, order) => ({ ...range, order }))
    .sort((a, b) => a.startOffset - b.startOffset);
  const heap: (Range & { order: number })[] = [];
  let cursor = 0;
  const output: T[] = [];
  for (const point of points) {
    while (
      cursor < ranges.length &&
      ranges[cursor].startOffset <= point.offset
    ) {
      const range = ranges[cursor++];
      let index = heap.length;
      heap.push(range);
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (priority(heap[parent], range) <= 0) break;
        heap[index] = heap[parent];
        index = parent;
      }
      heap[index] = range;
    }
    while (heap.length && heap[0].endOffset <= point.offset) {
      const last = heap.pop();
      if (!heap.length || !last) break;
      let index = 0;
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1;
        if (
          child + 1 < heap.length &&
          priority(heap[child + 1], heap[child]) < 0
        )
          child++;
        if (priority(last, heap[child]) <= 0) break;
        heap[index] = heap[child];
        index = child;
      }
      heap[index] = last;
    }
    if (heap[0]?.count) output.push(point);
  }
  return output;
}

/** Per-test V8 branch coverage remapped to the pinned TypeScript source. */
export class SourceCoverage {
  private session = new Session();
  private scripts = new Map<
    string,
    { sourceMapURL?: string; startLine: number; startColumn: number }
  >();
  private sources = new Map<string, FunctionCoverage<Point>>();

  async start(): Promise<void> {
    this.session.connect();
    this.session.on('Debugger.scriptParsed', ({ params }) => {
      if (
        params.url.includes('/lexical-upstream/packages/') &&
        !params.url.includes('/__tests__/')
      ) {
        this.scripts.set(params.scriptId, params);
      }
    });
    await this.session.post('Debugger.enable');
    await this.session.post('Profiler.enable');
    await this.session.post('Profiler.startPreciseCoverage', {
      callCount: true,
      detailed: true,
    });
  }

  async reset(): Promise<void> {
    await this.session.post('Profiler.takePreciseCoverage');
  }

  async take(): Promise<{ s2Hits: string[]; lines: Record<string, number[]> }> {
    const { result } = await this.session.post('Profiler.takePreciseCoverage');
    const lines = new Map<string, Set<number>>();
    for (const script of result) {
      const info = this.scripts.get(script.scriptId);
      if (
        !info ||
        !script.functions.some((fn) => fn.ranges.some((r) => r.count))
      )
        continue;
      let source = this.sources.get(script.scriptId);
      if (!source) {
        const { scriptSource } = await this.session.post(
          'Debugger.getScriptSource',
          { scriptId: script.scriptId }
        );
        const encoded = info.sourceMapURL?.match(
          /^data:application\/json[^,]*;base64,(.*)$/
        )?.[1];
        if (!encoded) continue;
        const map = new TraceMap(
          JSON.parse(Buffer.from(encoded, 'base64').toString())
        );
        const offsets = [0];
        for (let i = 0; i < scriptSource.length; i++)
          if (scriptSource[i] === '\n') offsets.push(i + 1);
        const points: Point[] = [];
        eachMapping(map, (mapping) => {
          if (!mapping.source || mapping.originalLine === null) return;
          let file = mapping.source;
          if (!file.startsWith('/') && !file.startsWith('file:'))
            file = new NodeURL(file, script.url).href;
          if (file.startsWith('file:')) file = fileURLToPath(file);
          const index = file.indexOf('packages/');
          if (index < 0) return;
          file = file.slice(index);
          const line = patchLines.original(file, mapping.originalLine);
          if (line === undefined) return;
          points.push({
            offset:
              (offsets[mapping.generatedLine - 1] ?? 0) +
              mapping.generatedColumn,
            file,
            line,
          });
        });
        points.sort((a, b) => a.offset - b.offset);
        source = new FunctionCoverage(scriptSource, points);
        this.sources.set(script.scriptId, source);
      }
      for (const point of source.covered(script.functions, coveredPoints)) {
        const hit = lines.get(point.file) ?? new Set<number>();
        hit.add(point.line);
        lines.set(point.file, hit);
      }
    }
    const s2Hits = locations
      .filter((location) =>
        [...(lines.get(location.file) ?? [])].some(
          (line) => line >= location.start && line <= location.end
        )
      )
      .map((location) => location.id);
    return {
      s2Hits: [...new Set(s2Hits)].sort(),
      lines: Object.fromEntries(
        [...lines]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([file, hit]) => [file, [...hit].sort((a, b) => a - b)])
      ),
    };
  }

  async close(): Promise<void> {
    await this.session.post('Profiler.stopPreciseCoverage');
    await this.session.post('Profiler.disable');
    await this.session.post('Debugger.disable');
    this.session.disconnect();
  }
}
