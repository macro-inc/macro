import { render } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { PrSplitHeader } from './PrSplitHeader';

vi.mock('@core/block', () => ({
  useBlockId: () => {
    throw new Error('PR detail must not read block identity');
  },
}));
vi.mock('@components/app/split-layout/components/SplitHeader', () => ({
  SplitHeaderLeft: (props: { children: unknown }) => props.children,
}));
vi.mock('@components/app/split-layout/components/SplitLabel', () => ({
  StaticSplitLabel: (props: { label: string }) => <span>{props.label}</span>,
  SplitTitleFileMenu: (props: { children: unknown }) => props.children,
}));
vi.mock('@components/app/split-layout/components/SplitFileMenu', () => ({
  SplitFileMenu: (props: { id: string; entityKind: string }) => (
    <span data-testid="pr-menu">{`${props.entityKind}:${props.id}`}</span>
  ),
}));

describe('PrSplitHeader', () => {
  it('uses explicit PR identity without a block provider', () => {
    const view = render(() => (
      <PrSplitHeader
        foreignEntityId="foreign-pr-1"
        prRef={{ owner: 'macro', repo: 'web', number: 12 }}
        enrichment={undefined}
      />
    ));
    expect(view.getByTestId('pr-menu').textContent).toBe('pr:foreign-pr-1');
  });
});
