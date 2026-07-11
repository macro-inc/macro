import { describe, expect, it } from 'vitest';
import { compileToAst, defineQueryFilters, queryStateFrom } from './compile';
import type { DocumentFilterExpression, QueryState } from './types';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

describe('defineQueryFilters', () => {
  it('treats emailView as referencing the email target', () => {
    const query = defineQueryFilters({ emailView: 'sent' });

    // No match-nothing filter on the email target itself...
    expect(query.include?.threadId).toBeUndefined();
    // ...while other entity targets are still excluded.
    expect(query.include?.documentId).toEqual([NIL_UUID]);
    expect(query.include?.chatId).toEqual([NIL_UUID]);
  });

  it('stuffs match-nothing filters on all targets when nothing is referenced', () => {
    const query = defineQueryFilters({});

    expect(query.include?.threadId).toEqual([NIL_UUID]);
    expect(query.include?.documentId).toEqual([NIL_UUID]);
  });
});

describe('compileToAst', () => {
  it('keeps existing flat include and exclude document filters unchanged', () => {
    const state: QueryState = {
      include: {
        fileType: ['pdf', 'md'],
        subType: ['snippet', 'task'],
      },
      exclude: {
        documentOwnerId: ['user-1'],
      },
    };

    expect(compileToAst(state).df).toEqual({
      '&': [
        {
          '|': [{ l: { ft: 'pdf' } }, { l: { ft: 'md' } }],
        },
        {
          '&': [
            {
              '|': [{ l: { dst: 'snippet' } }, { l: { dst: 'task' } }],
            },
            {
              '!': { l: { o: 'user-1' } },
            },
          ],
        },
      ],
    });
  });

  it('compiles nested documentWhere OR across file type and subtype groups', () => {
    const expression: DocumentFilterExpression = {
      op: 'or',
      clauses: [
        { include: { fileType: ['pdf'] } },
        {
          op: 'and',
          clauses: [
            { include: { fileType: ['md'] } },
            { include: { subType: ['snippet', 'task'] } },
          ],
        },
      ],
    };

    expect(
      compileToAst({
        include: {},
        exclude: {},
        documentWhere: [expression],
      }).df
    ).toEqual({
      '|': [
        { l: { ft: 'pdf' } },
        {
          '&': [
            { l: { ft: 'md' } },
            {
              '|': [{ l: { dst: 'snippet' } }, { l: { dst: 'task' } }],
            },
          ],
        },
      ],
    });
  });

  it('ANDs documentWhere with top-level document filters', () => {
    expect(
      compileToAst({
        include: { projectId: ['project-1'] },
        exclude: {},
        documentWhere: [{ include: { fileType: ['pdf'] } }],
      }).df
    ).toEqual({
      '&': [{ l: { pid: 'project-1' } }, { l: { ft: 'pdf' } }],
    });
  });

  it('supports NOT groups in documentWhere', () => {
    expect(
      compileToAst({
        include: {},
        exclude: {},
        documentWhere: [
          {
            op: 'not',
            clause: { include: { subType: ['task'] } },
          },
        ],
      }).df
    ).toEqual({
      '!': { l: { dst: 'task' } },
    });
  });

  it('normalizes query documentWhere into QueryState', () => {
    expect(
      queryStateFrom({
        documentWhere: { include: { fileType: ['pdf'] } },
      }).documentWhere
    ).toEqual([{ include: { fileType: ['pdf'] } }]);
  });

  it('compiles foreign entity source filters to the backend AST source literal', () => {
    const ast = compileToAst(
      queryStateFrom({
        include: {
          foreignEntitySource: ['github_pull_request'],
          foreignEntityDone: false,
        },
      })
    );

    expect(ast.fef).toEqual({
      '&': [{ l: { fes: 'github_pull_request' } }, { l: { nd: false } }],
    });
  });

  it('compiles channel message thread ids onto regular channel filters', () => {
    const ast = compileToAst(
      queryStateFrom({
        include: {
          channelMessageThreadId: ['00000000-0000-0000-0000-000000000001'],
        },
      })
    );

    expect(ast.chanf).toEqual({
      l: { ThreadId: '00000000-0000-0000-0000-000000000001' },
    });
  });

  it('compiles channel-thread root sender excludes onto channel-thread filters', () => {
    const ast = compileToAst(
      queryStateFrom({
        exclude: {
          channelThreadRootSenderId: ['macro|me@example.com'],
        },
      })
    );

    expect(ast.cthf).toEqual({
      '!': { l: { RootSender: 'macro|me@example.com' } },
    });
  });

  it('compiles tag filters as one OR group across definitions by default', () => {
    const ast = compileToAst(
      queryStateFrom({
        include: {
          tagFilters: [
            { propertyId: 'def-1', type: 'select', value: 'opt-1' },
            { propertyId: 'def-2', type: 'select', value: 'opt-2' },
          ],
        },
      })
    );

    expect(ast.propf).toEqual({
      '|': [
        { l: { pd: 'def-1', v: { so: 'opt-1' } } },
        { l: { pd: 'def-2', v: { so: 'opt-2' } } },
      ],
    });
  });

  it('compiles tag filters as an AND group when tagFilterMode is all', () => {
    const ast = compileToAst(
      queryStateFrom({
        include: {
          tagFilterMode: 'all',
          tagFilters: [
            { propertyId: 'def-1', type: 'select', value: 'opt-1' },
            { propertyId: 'def-2', type: 'select', value: 'opt-2' },
          ],
        },
      })
    );

    expect(ast.propf).toEqual({
      '&': [
        { l: { pd: 'def-1', v: { so: 'opt-1' } } },
        { l: { pd: 'def-2', v: { so: 'opt-2' } } },
      ],
    });
  });
});
