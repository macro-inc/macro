/** @vitest-environment jsdom */
import { render } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { buildTagTree } from '../core/tag-tree';
import { BranchTagIcon } from './branch-tag-icon';

describe('BranchTagIcon', () => {
  it('retains the parent color when a differently colored child is added', () => {
    const tree = buildTagTree([
      {
        id: 'parent',
        label: 'soupio',
        color: 'blue',
        scope: 'user',
        propertyDefinitionId: 'tags',
      },
      {
        id: 'child',
        label: 'soupio/dink',
        color: 'yellow',
        scope: 'user',
        propertyDefinitionId: 'tags',
      },
    ]);
    const { container } = render(() => <BranchTagIcon node={tree[0]} />);
    const dot = container.querySelector<HTMLElement>('[data-slot="tag-dot"]');
    expect(dot?.style.background).toBe(
      'conic-gradient(blue 0% 50%, yellow 50% 100%)'
    );
    expect(dot?.classList.contains('size-2.5')).toBe(true);
  });
});
