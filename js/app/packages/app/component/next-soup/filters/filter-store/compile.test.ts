import { describe, expect, it } from 'vitest';
import { compileToAst, queryStateFrom } from './compile';

describe('compileToAst', () => {
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
