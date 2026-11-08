import { inputColorTokens } from '../src/features/theme/types/themeTypes';
import {
  getDefaultSemanticColorTokens,
  PALETTE_HUES,
} from '../src/features/theme/utils/themeColorTokens';
import { convertThemev2v3 } from '../src/features/theme/utils/themeMigrations';
import {
  parseThemeV2Json,
  parseThemeV3Json,
} from '../src/features/theme/utils/themeValidation';

const root = new URL(
  '../../../crates/client/lexical/macro_document_model/src/plugins_group_b/',
  import.meta.url
);
const constants = {
  inputs: inputColorTokens,
  hues: PALETTE_HUES,
  semantics: {
    light: getDefaultSemanticColorTokens('light'),
    dark: getDefaultSemanticColorTokens('dark'),
  },
};
const cases: { input: unknown; expected: unknown }[] = [];
for (const mode of ['light', 'dark']) {
  for (const overrides of [false, true, 'loose']) {
    const tokens = Object.fromEntries(
      ['a', 'b', 'c'].flatMap((prefix) =>
        Array.from({ length: 5 }, (_, index) => [
          prefix + index,
          {
            l:
              prefix === 'a'
                ? 0.61
                : prefix === 'b'
                  ? (mode === 'dark' ? 0.1 : 0.9) + index * 0.015
                  : mode === 'dark'
                    ? 0.95 - index * 0.1
                    : 0.1 + index * 0.1,
            c: prefix === 'a' ? 0.123456789 : 0.018,
            h: prefix === 'a' ? 269.7 : 72,
          },
        ])
      )
    );
    const input = {
      id: 'fixture-theme',
      name: 'Fixture theme',
      version: 2,
      depth: 0.15,
      tokens,
      ...(overrides
        ? {
            overrides: [
              {
                token: 'ink',
                value:
                  overrides === 'loose'
                    ? { l: '2', c: [], h: null }
                    : { l: 0.8, c: 0.08, h: 29.5 },
              },
            ],
            colorTokens: { accent: '#abcdef', 'future-token': 'custom' },
          }
        : {}),
    };
    const parsed = parseThemeV2Json(JSON.stringify(input));
    if (!parsed) throw new Error('Invalid legacy oracle input');
    cases.push({ input, expected: convertThemev2v3(parsed) });
    const next = { ...convertThemev2v3(parsed), future: { keep: true } };
    cases.push({
      input: next,
      expected: parseThemeV3Json(JSON.stringify(next)),
    });
  }
}
for (const input of [
  null,
  {},
  {
    id: 'fixture-theme',
    name: 'bad',
    version: 3,
    mode: 'light',
    colorTokens: { accent: '  ' },
  },
])
  cases.push({ input, expected: null });
for (const [name, value] of [
  ['theme-paste-constants.json', constants],
  ['theme-paste-cases.json', cases],
] as const) {
  const path = new URL(name, root);
  const text = JSON.stringify(value, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if ((await Bun.file(path).text()) !== text)
      throw new Error('Stale theme paste source data: ' + name);
  } else await Bun.write(path, text);
}
