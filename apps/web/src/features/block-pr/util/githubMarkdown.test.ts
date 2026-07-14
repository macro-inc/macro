import { describe, expect, it } from 'vitest';

import { cleanGithubMarkdown } from './githubMarkdown';

describe('cleanGithubMarkdown', () => {
  it('renders CodeRabbit svg badges as regular links', () => {
    expect(
      cleanGithubMarkdown(
        '![Review Change Stack](https://storage.googleapis.com/coderabbit_public_assets/review-stack-in-coderabbit-ui.svg)'
      )
    ).toBe(
      '[Review Change Stack](https://storage.googleapis.com/coderabbit_public_assets/review-stack-in-coderabbit-ui.svg)'
    );
  });
});
