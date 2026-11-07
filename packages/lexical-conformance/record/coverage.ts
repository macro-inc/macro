import { readFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { eachMapping, TraceMap } from '@jridgewell/trace-mapping';

type Range = { startOffset: number; endOffset: number; count: number };
type Location = { file: string; start: number; end: number; id: string };
const locations: Location[] = JSON.parse(
  readFileSync(new NodeURL('./s2-ranges.json', import.meta.url), 'utf8')
);

/** Per-test V8 branch coverage remapped to the pinned TypeScript source. */
export class SourceCoverage {
  private session = new Session();
  private scripts = new Map<
    string,
    { sourceMapURL?: string; startLine: number; startColumn: number }
  >();
  private sources = new Map<string, { code: string; map: TraceMap }>();

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
        source = {
          code: scriptSource,
          map: new TraceMap(
            JSON.parse(Buffer.from(encoded, 'base64').toString())
          ),
        };
        this.sources.set(script.scriptId, source);
      }
      const offsets = [0];
      for (let i = 0; i < source.code.length; i++)
        if (source.code[i] === '\n') offsets.push(i + 1);
      const ranges: Range[] = script.functions
        .flatMap((fn) => fn.ranges)
        .sort(
          (a, b) => a.endOffset - a.startOffset - (b.endOffset - b.startOffset)
        );
      eachMapping(source.map, (mapping) => {
        if (!mapping.source || mapping.originalLine === null) return;
        const offset =
          (offsets[mapping.generatedLine - 1] ?? 0) + mapping.generatedColumn;
        const range = ranges.find(
          (r) => r.startOffset <= offset && offset < r.endOffset
        );
        if (!range?.count) return;
        let file = mapping.source;
        if (!file.startsWith('/') && !file.startsWith('file:'))
          file = new NodeURL(file, script.url).href;
        if (file.startsWith('file:')) file = fileURLToPath(file);
        const index = file.indexOf('packages/');
        if (index < 0) return;
        file = file.slice(index);
        const hit = lines.get(file) ?? new Set<number>();
        hit.add(mapping.originalLine);
        lines.set(file, hit);
      });
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
