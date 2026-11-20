import { describe, expect, it } from 'vitest';
import { replaceCitations } from './citationsUtils';

describe('replaceCitations', () => {
  it('keeps double brackets inside code fences as written', async () => {
    const markdown = [
      'Intro [[not-a-citation]] here',
      '```prompt',
      'Write [[CUSTOMER]] literally',
      '```',
      'Between [[gone]]',
      '~~~',
      '```',
      '[[kept]]',
      '~~~',
      'Outro [[also-gone]]',
    ].join('\n');

    expect(await replaceCitations(markdown)).toBe(
      [
        'Intro  here',
        '```prompt',
        'Write [[CUSTOMER]] literally',
        '```',
        'Between ',
        '~~~',
        '```',
        '[[kept]]',
        '~~~',
        'Outro ',
      ].join('\n')
    );
  });

  it('leaves an unclosed fence as code to the end', async () => {
    expect(await replaceCitations('```\n[[open]]\nstill code')).toBe(
      '```\n[[open]]\nstill code'
    );
  });
});
