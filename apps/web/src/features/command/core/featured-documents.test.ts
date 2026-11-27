import { expect, it } from 'vitest';
import { featuredCommandDocumentIds } from './featured-documents';

it('lists the first few document rows of a typed query', () => {
  const items = [
    { bucket: 'channel', id: 'channel-1' },
    { bucket: 'document', id: 'doc-1' },
    { kind: 'command', id: 'command-1' },
    { bucket: 'task', id: 'task-1' },
    { bucket: 'note', id: 'note-1' },
    { bucket: 'document', id: 'doc-2' },
  ];

  expect(featuredCommandDocumentIds(items, 'launch')).toEqual([
    'doc-1',
    'task-1',
    'note-1',
  ]);
  // Recent rows before typing are not searched, so none are checked.
  expect(featuredCommandDocumentIds(items, '  ')).toEqual([]);
});

it('checks snippets and skills, which are cached document records too', () => {
  const items = [
    { bucket: 'snippet', id: 'snippet-1' },
    { bucket: 'skill', id: 'skill-1' },
    { bucket: 'email', id: 'email-1' },
  ];

  expect(featuredCommandDocumentIds(items, 'reply')).toEqual([
    'snippet-1',
    'skill-1',
  ]);
});
