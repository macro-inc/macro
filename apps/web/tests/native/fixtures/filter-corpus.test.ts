import { expect, test } from 'bun:test';
import capsules from './filter-capsules.json';
import {
  documentCapsuleInputs,
  FILE_TYPES,
  filterCorpus,
  PEOPLE,
} from './filter-corpus';
import { fixtureId } from './mail';

const corpus = filterCorpus(capsules);

test('matrix corpus has unique identities and stays within one initial page', () => {
  expect(corpus).toHaveLength(77);
  expect(
    new Set(corpus.map((row) => `${row.api.__typename}:${row.id}`)).size
  ).toBe(corpus.length);
  expect(corpus.length).toBeLessThanOrEqual(100);
});

test.each(FILE_TYPES)(
  'each file type has owned and shared examples: %s',
  (category) => {
    const rows = corpus.filter(
      (row) => row.kind === 'file' && row.category === category
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.owner)).toEqual(PEOPLE);
  }
);

test('spreadsheets have native spreadsheet types, not ordinary file stand-ins', () => {
  const rows = corpus.filter((row) => row.category === 'doc-spreadsheet');
  expect(rows.map((row) => row.id)).toEqual([fixtureId(103), fixtureId(114)]);
  for (const row of rows) {
    expect(row.fileType).toBe('spreadsheet');
    expect(row.api.fileType).toBe('spreadsheet');
    expect(row.api.subType).toBeNull();
  }
});

test('inserting a file type does not move snippet and skill subtype meanings', () => {
  for (const [category, typename] of [
    ['doc-snippet', 'GraphqlSnippetSubType'],
    ['doc-skill', 'GraphqlSkillSubType'],
  ]) {
    const rows = corpus.filter((row) => row.category === category);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.api.fileType).toBe('md');
      expect(row.api.subType).toEqual({ __typename: typename });
    }
  }
});

test('canonical capsules cover every document and task fixture', () => {
  expect(Object.keys(capsules).sort()).toEqual(
    documentCapsuleInputs()
      .map((row) => row.id)
      .sort()
  );
  expect(Object.keys(capsules)).toHaveLength(62);
  for (const row of corpus.filter(
    (row) => row.kind === 'file' || row.kind === 'task'
  )) {
    expect(row.api.cacheProjection).toBeString();
  }
});

test('favorite facts have positive and negative witnesses across inbox scopes', () => {
  const mail = corpus.filter((row) => row.kind === 'email');
  expect(mail.filter((row) => row.favorite).map((row) => row.id)).toEqual(
    [6, 8, 9, 60, 71].map(fixtureId)
  );
  expect(mail.some((row) => !row.favorite)).toBe(true);
  for (const row of mail) expect(row.api.isFavorited).toBe(row.favorite);
});
