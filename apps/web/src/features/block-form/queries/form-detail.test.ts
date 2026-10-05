import { expect, it } from 'vitest';
import { toLayoutDocument } from './form-detail';

it('refuses to send a gate without rules rather than inventing an empty rule group', () => {
  expect(() =>
    toLayoutDocument({
      sections: [
        {
          id: 'gate',
          title: '',
          description: '',
          kind: 'gate',
          gateRules: null,
          gateMessage: 'Not this time.',
          questions: [],
        },
      ],
    })
  ).toThrow('Gate “gate” has no rules');
});
