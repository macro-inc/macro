import { describe, expect, it } from 'vitest';
import { createFakeActivityDeps, FAKE_VIEWER_ID } from '../testing/fake-deps';
import { createActorName } from './actor-name';

describe('createActorName', () => {
  const deps = createFakeActivityDeps();

  it('names the viewer "You"', () => {
    expect(createActorName(deps, () => FAKE_VIEWER_ID)()).toBe('You');
  });

  it('resolves other users through displayName', () => {
    expect(createActorName(deps, () => 'macro|sarah@example.com')()).toBe(
      'sarah'
    );
  });

  it('labels non-user actors as automation', () => {
    expect(createActorName(deps, () => 'system:nightly')()).toBe('Automation');
  });
});
