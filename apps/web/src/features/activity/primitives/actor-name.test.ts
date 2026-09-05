import { describe, expect, it } from 'vitest';
import {
  createMockActivityContext,
  MOCK_VIEWER_ID,
} from '../tests/mock-context';
import { createActorName } from './actor-name';

describe('createActorName', () => {
  const context = createMockActivityContext();

  it('names the viewer "You"', () => {
    expect(createActorName(context, () => MOCK_VIEWER_ID)()).toBe('You');
  });

  it('resolves other users through displayName', () => {
    expect(createActorName(context, () => 'macro|sarah@example.com')()).toBe(
      'sarah'
    );
  });

  it('labels non-user actors as automation', () => {
    expect(createActorName(context, () => 'system:nightly')()).toBe(
      'Automation'
    );
  });
});
