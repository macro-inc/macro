/**
 * permissions.json classifies exactly the operations in the specs, and the
 * committed operations.json is what build.ts writes from them.
 *
 *   bun test spec
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOperations, operationsPath, renderOperations } from './build';
import { readSpecOperations } from './specs';

describe('the committed files', () => {
  test('permissions.json classifies every operation and operations.json is current', () => {
    const table = buildOperations();

    expect(table.length).toBe(readSpecOperations().length);
    expect(readFileSync(operationsPath, 'utf8')).toBe(renderOperations(table));
  });
});

describe('checks', () => {
  // Two services; `notes` repeats one operationId on two routes.
  const dir = mkdtempSync(join(tmpdir(), 'spec-permissions-'));

  writeFileSync(
    join(dir, 'notes.json'),
    JSON.stringify({
      paths: {
        '/notes': {
          get: { operationId: 'list' },
          post: { operationId: 'create_note' },
        },
        '/notes/archived': { get: { operationId: 'list' } },
      },
    })
  );
  writeFileSync(
    join(dir, 'mail.json'),
    JSON.stringify({
      paths: {
        '/send': {
          post: {
            operationId: 'send',
            parameters: [
              { name: 'X-Mail-Token', in: 'header' },
              { name: 'draft', in: 'query' },
            ],
          },
        },
      },
    })
  );

  const renames = { notes: { 'GET /notes/archived': 'list_archived' } };

  test('renames resolve a duplicate operationId', () => {
    expect(
      readSpecOperations(dir, renames).map((operation) => operation.name)
    ).toEqual([
      'mail.send',
      'notes.list',
      'notes.create_note',
      'notes.list_archived',
    ]);
  });

  test('an unresolved duplicate and a rename matching nothing fail', () => {
    expect(() =>
      readSpecOperations(dir, { notes: { 'GET /nowhere': 'x' } })
    ).toThrow(
      [
        'renames.json: notes "GET /nowhere" matches no operation',
        'duplicate operation name notes.list (GET /notes, GET /notes/archived): add renames.json entries',
      ].join('\n')
    );
  });

  test('unclassified operations, stale entries and invalid values fail', () => {
    const permissions = {
      'mail.send': { group: 'email', action: 'send' },
      'notes.list': { group: 'notes', action: 'list' },
      'notes.create_note': { group: 'Notes', action: 'create' },
      'notes.gone': { group: 'notes', action: 'read' },
    };

    expect(() =>
      buildOperations(readSpecOperations(dir, renames), permissions)
    ).toThrow(
      [
        'notes.list: invalid action "list" (one of create, read, update, destroy, send)',
        'notes.create_note: invalid group "Notes"',
        'unclassified operation notes.list_archived (GET /notes/archived)',
        'stale entry notes.gone: no such operation in the specs',
      ].join('\n')
    );
  });

  test('a complete classification builds the table, with declared header parameters lowercased', () => {
    const permissions = {
      'mail.send': { group: 'email', action: 'send' },
      'notes.list': { group: 'notes', action: 'read' },
      'notes.create_note': { group: 'notes', action: 'create' },
      'notes.list_archived': { group: 'notes', action: 'read' },
    };

    expect(
      buildOperations(readSpecOperations(dir, renames), permissions)[0]
    ).toEqual({
      name: 'mail.send',
      service: 'mail',
      operationId: 'send',
      method: 'POST',
      path: '/send',
      group: 'email',
      action: 'send',
      headers: ['x-mail-token'],
    });
  });
});
