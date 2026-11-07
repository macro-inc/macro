import { expect, test } from 'vitest';
import { covered, type MatrixRow, seeds, tags } from '../matrix';
import { HEADER } from '../seed-markdown';

const row: MatrixRow = {
  kind: 'sym',
  id: 'S2:lexical:$getRoot',
  package: 'lexical',
  class: 'MODEL',
  pri: 'P0',
  owner: 'rust:lexical_model',
  gate: 'required',
  tier: 'A-rec|A-hand',
  test_id: 'index:lexical/$getRoot',
  test_file: '',
  also: '',
  milestone: 'M1',
  source: 'S2:1',
  tests: [],
  owners: [],
  fixtures: [{ id: 'case', file: 'upstream/lexical/case.json' }],
  observedFixtures: [],
};
test('recorded, failed and ledgered fixtures cannot certify Rust coverage', () => {
  expect(covered(row, undefined, [])).toBe(false);
  for (const status of ['fail', 'ledger'] as const)
    expect(
      covered(
        row,
        {
          inputs: '',
          cases: { 'upstream/lexical/case.json': { status, error: null } },
        },
        []
      )
    ).toBe(false);
  expect(
    covered(
      row,
      {
        inputs: '',
        cases: {
          'upstream/lexical/case.json': { status: 'pass', error: null },
        },
      },
      []
    )
  ).toBe(true);
});
test('Rust-owned behavior needs an implementation owner', () => {
  const behavior = { ...row, kind: 'beh', id: 'SEL-12' };
  expect(
    covered(
      behavior,
      {
        inputs: '',
        cases: {
          'upstream/lexical/case.json': { status: 'pass', error: null },
        },
      },
      []
    )
  ).toBe(false);
});
test('tags retain exact files, line numbers and ignored test state', () => {
  expect(
    tags(
      'test.rs',
      '/// covers: SEL-12, S3:node:TextNode\n#[ignore]\nfn example() {}',
      'covers'
    )
  ).toEqual([
    ['SEL-12', { file: 'test.rs', line: 1, ignored: true, test: 'example' }],
    [
      'S3:node:TextNode',
      { file: 'test.rs', line: 1, ignored: true, test: 'example' },
    ],
  ]);
  expect(
    tags(
      'test.ts',
      '// covers: SEL-12\ntest.skip("example", () => {});',
      'covers'
    )[0][1].ignored
  ).toBe(true);
});
test('seed fields retain empty cells rather than shifting their columns', () => {
  expect(
    seeds(
      HEADER.join('\t') +
        '\n' +
        HEADER.map((name) => (name === 'test_file' ? '' : 'value')).join('\t') +
        '\n'
    )[0].test_file
  ).toBe('');
});

test('TS comments cannot satisfy a Rust implementation owner', () => {
  expect(
    tags('implementation.ts', '// s2: HIS-15\nfunction handler() {}', 's2')
  ).toEqual([]);
  expect(
    tags(
      'crates/client/lexical/lexical_model/src/test.rs',
      '/// s2: HIS-15\n#[test]\nfn handler() {}',
      's2'
    )
  ).toEqual([]);
});

test('test-only enclosing scopes cannot own production behavior', () => {
  const file = 'crates/client/lexical/lexical_model/src/example.rs';
  const source = `
#[cfg(test)]
mod tests {
  const BRACE: &str = "}";
  /* nested /* ignored */ } */
  // s2: HIS-15
  fn helper() {}
  mod nested {
    // s2: SEL-12
    fn nested_helper() {}
  }
}
// s2: HIS-16
pub fn production() {}
#[cfg(test)] mod other_tests;
// s2: HIS-17
pub fn after_declaration() {}
`;
  expect(tags(file, source, 's2').map(([id]) => id)).toEqual([
    'HIS-16',
    'HIS-17',
  ]);
});

test('doc tags before compound or spaced cfg attributes remain test-only', () => {
  for (const attribute of ['#[cfg(any(test))]', '#[ cfg(test)]'])
    expect(
      tags(
        'src/example.rs',
        `/// s2: HIS-15\n${attribute}\nfn helper() {}`,
        's2'
      )
    ).toEqual([]);
});
