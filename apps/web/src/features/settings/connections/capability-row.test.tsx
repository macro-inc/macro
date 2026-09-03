/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';
import { capabilityFacts } from './capability-row';

describe('capabilityFacts', () => {
  it('keeps Pipedream rows to the power attribution only', () => {
    expect(
      capabilityFacts({
        account: 'Notion',
        scope: 'personal',
        mechanism: 'pipedream',
      })
    ).toBe('Powered by Pipedream');
  });

  it('keeps account and scope for non-Pipedream rows', () => {
    expect(
      capabilityFacts({
        account: 'cam@macro.com',
        scope: 'personal',
        mechanism: 'macro',
      })
    ).toBe('cam@macro.com · Personal');
  });
});
