import { describe, expect, it } from 'vitest';
import { compileToAst, queryStateFrom } from './compile';
import type { DocumentFilterExpression, QueryState } from './types';

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
});
