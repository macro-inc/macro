import { expect, test } from 'vitest';
import { transformerReferences } from '../transformers';

test('transformer references retain exact source identity', () => {
  expect(
    transformerReferences({ id: 'S3:tf:HEADING', package: 'lexical_markdown' })
  ).toEqual(['@lexical/markdown.HEADING']);
  expect(
    transformerReferences({
      id: 'S3:tf:PRESERVE_LINES',
      package: 'macro_document_model',
    })
  ).toEqual([
    '@macro-inc/lexical-core/transformers/transformers.PRESERVE_LINES',
  ]);
});
