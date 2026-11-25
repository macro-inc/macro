import type { EntityData } from '@entity';
import { expect, it, vi } from 'vitest';
import { createAppCrmNavigation } from './navigation-adapter';

const openEntityInSplit = vi.hoisted(() => vi.fn(async () => undefined));
const customersSplit = vi.hoisted(() => ({ id: 'customers' }));

vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({}),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => ({ handle: customersSplit }),
}));
vi.mock('../next-soup/utils', () => ({
  openEntityInSplitFromUnifiedList: openEntityInSplit,
}));

const file = { type: 'document', id: 'file-1', name: 'Contract' } as EntityData;

it('opens a row from the Customers split, in a new split only when asked to', () => {
  const navigation = createAppCrmNavigation();
  navigation.openEntity(file, { newSplit: true });
  navigation.openEntity(file);
  expect(openEntityInSplit).toHaveBeenNthCalledWith(1, file, {
    openInNewSplit: true,
    splitHandle: customersSplit,
  });
  expect(openEntityInSplit).toHaveBeenNthCalledWith(2, file, {
    openInNewSplit: undefined,
    splitHandle: customersSplit,
  });
});
