import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Reporter, TestCase, TestModule } from 'vitest/node';

type NamedCase = { id: string; fullName: string };

export function caseName(
  test: NamedCase,
  declared: Iterable<NamedCase>
): string {
  const siblings = [...declared].filter(
    (entry) => entry.fullName === test.fullName
  );
  const occurrence = siblings.findIndex((entry) => entry.id === test.id);
  if (occurrence < 0) throw new Error('Test missing from its declaration tree');
  return occurrence
    ? `${test.fullName} [case ${occurrence + 1}]`
    : test.fullName;
}

/** Persist all classifications; only passing, independently replayed cases are fixtures. */
export default class FixtureReporter implements Reporter {
  async onTestCaseResult(test: TestCase): Promise<void> {
    const dir = process.env.LEXICAL_RECORD_OUTPUT;
    if (!dir) throw new Error('LEXICAL_RECORD_OUTPUT is required');
    const meta = (test.meta() as Record<string, unknown>).lexical;
    const value = (meta ?? {
      fixture: {},
      reasons: ['upstream-not-recorded'],
      assertions: 0,
      calls: 0,
      s2Hits: [],
      transformersFired: [],
    }) as {
      fixture: Record<string, unknown>;
      reasons: string[];
      assertions: number;
      calls: number;
    };
    const id = `${test.module.moduleId.split('/packages/')[1]}::${caseName(test, test.module.children.allTests())}`;
    const slug = createHash('sha256').update(id).digest('hex');
    if (
      'source' in value.fixture &&
      value.fixture.source &&
      typeof value.fixture.source === 'object'
    ) {
      Object.assign(value.fixture.source, { test: test.fullName.split(' > ') });
    }
    await mkdir(path.join(dir, 'cases'), { recursive: true });
    await writeFile(
      path.join(dir, 'cases', `${slug}.json`),
      JSON.stringify({
        id,
        state: test.result().state,
        errors: test.result().errors?.map((error) => error.message),
        failures: test.result().errors?.map((error) => {
          const frame = error.stacks?.find((frame) =>
            frame.file.includes('/lexical-upstream/packages/')
          );
          const location = frame
            ? `${frame.file.replace(process.env.LEXICAL_UPSTREAM + '/', '')}:${frame.line}`
            : error.message
                .split('\n')[0]
                .replaceAll(process.env.LEXICAL_UPSTREAM + '/', '');
          return `${error.name ?? 'Error'}: ${location}`;
        }),
        ...value,
      })
    );
  }
  async onTestModuleEnd(module: TestModule): Promise<void> {
    if ([...module.children.allTests()].length || module.state() !== 'failed')
      return;
    const dir = process.env.LEXICAL_RECORD_OUTPUT;
    if (!dir) throw new Error('LEXICAL_RECORD_OUTPUT is required');
    const id = `${module.moduleId.split('/packages/')[1]}::<module-load>`;
    await mkdir(path.join(dir, 'cases'), { recursive: true });
    await writeFile(
      path.join(
        dir,
        'cases',
        `${createHash('sha256').update(id).digest('hex')}.json`
      ),
      JSON.stringify({
        id,
        state: 'failed',
        assertions: 0,
        calls: 0,
        reasons: [
          'upstream-module-load-failed',
          ...module
            .errors()
            .map(
              (error) =>
                `module-load: ${error.message.split('\n')[0].replaceAll(process.env.LEXICAL_UPSTREAM + '/', '')}`
            ),
        ],
        fixture: {},
        s2Hits: [],
        transformersFired: [],
      })
    );
  }
}
