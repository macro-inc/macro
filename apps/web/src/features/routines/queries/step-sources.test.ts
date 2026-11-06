import { describe, expect, it, vi } from 'vitest';
import { useRoutineTags } from './step-sources';

const query = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock('@queries/properties/tags', () => ({
  useTagsQuery: () => query.current,
}));
vi.mock('@service-email/client', () => ({ emailClient: {} }));

const tags = [
  {
    scope: 'personal',
    options: [
      {
        id: 'option',
        propertyDefinitionId: 'definition',
        value: { type: 'string', value: 'Finance' },
        color: null,
      },
    ],
  },
];

describe('routine tag source', () => {
  it('keeps cached tags through a failed refetch and offers a retry', () => {
    const refetch = vi.fn(async () => undefined);
    query.current = {
      isPending: false,
      isError: true,
      data: tags,
      refetch,
    };
    const source = useRoutineTags();
    expect(source().map((tag) => tag.label)).toEqual(['Finance']);
    expect(source.status()).toBe('error');
    source.retry();
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('is loading, with nothing to show, until the first answer', () => {
    query.current = { isPending: true, isError: false, refetch: vi.fn() };
    const source = useRoutineTags();
    expect(source()).toEqual([]);
    expect(source.status()).toBe('pending');
  });
});
