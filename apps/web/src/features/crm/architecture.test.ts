// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const feature = dirname(fileURLToPath(import.meta.url));
const source = resolve(feature, '../..');
function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(path, entry.name))
      : /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)
        ? [join(path, entry.name)]
        : []
  );
}
function imports(file: string) {
  return [
    ...readFileSync(file, 'utf8').matchAll(
      /(?:from\s*|import\s*\()['"]([^'"]+)['"]/g
    ),
  ].map((match) => match[1]);
}
function crmTarget(file: string, path: string) {
  const absolute = path.startsWith('.')
    ? resolve(dirname(file), path)
    : path.startsWith('@app/')
      ? resolve(source, path.slice(5))
      : '';
  return absolute.startsWith(`${feature}/`)
    ? relative(feature, absolute)
    : undefined;
}

describe('CRM ownership boundaries', () => {
  it('keeps app consumers on explicit CRM entry points', () => {
    const leaks = files(source)
      .filter((file) => !file.startsWith(`${feature}/`))
      .flatMap((file) =>
        imports(file).flatMap((path) => {
          const target = crmTarget(file, path);
          return target &&
            /^(core|context|queries|primitives|components|views)\//.test(target)
            ? [`${relative(source, file)} -> ${path}`]
            : [];
        })
      );
    expect(leaks).toEqual([]);
  });
  it('keeps core pure and reactive consumers independent of production wiring', () => {
    const leaks = files(feature).flatMap((file) => {
      const layer = relative(feature, file).split('/')[0];
      return imports(file).flatMap((path) => {
        const target = crmTarget(file, path);
        const concrete =
          /^(?:@queries\/|@service-|@core\/context\/|@app\/lib\/analytics)/.test(
            path
          );
        const rootAdapter =
          target && !target.includes('/') && /adapter|^crm(?:-|$)/.test(target);
        const otherLayer = target?.split('/')[0];
        const invalid =
          layer === 'core'
            ? /^(?:solid-js|@queries\/|@service-|@core\/context\/)/.test(
                path
              ) ||
              (otherLayer && otherLayer !== 'core')
            : ['primitives', 'context'].includes(layer)
              ? concrete ||
                rootAdapter ||
                ['queries', 'views', 'components'].includes(otherLayer ?? '')
              : layer === 'views'
                ? concrete || rootAdapter || otherLayer === 'queries'
                : layer === 'components'
                  ? concrete ||
                    rootAdapter ||
                    ['queries', 'views', 'primitives'].includes(
                      otherLayer ?? ''
                    )
                  : false;
        return invalid ? [`${relative(feature, file)} -> ${path}`] : [];
      });
    });
    expect(leaks).toEqual([]);
  });
});
