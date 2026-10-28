import type { CrmCompanyEntity, EntityData } from '@entity';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CrmWorkspace } from '../context/workspace-context';
import { createCrmExportLoader } from './export-source';

const company = (id: string, loaded = true): CrmCompanyEntity => ({
  type: 'crm_company',
  id,
  name: id,
  ownerId: 'owner',
  teamId: 'team',
  hidden: false,
  domains: [],
  ...(loaded ? { properties: [] } : {}),
});
const isCompany = (entity: EntityData): entity is CrmCompanyEntity =>
  entity.type === 'crm_company';
const source = (
  overrides: Partial<CrmWorkspace['source']> = {}
): CrmWorkspace['source'] => ({
  error: () => undefined,
  data: () => [],
  isLoading: () => false,
  isFetching: () => false,
  hasNextPage: () => false,
  fetchNextPage: async () => {},
  ...overrides,
});
afterEach(() => vi.useRealTimers());

describe('current-view export loading', () => {
  it('loads all pages and hydrates only the companies in the selected view', async () => {
    vi.useFakeTimers();
    let next = true;
    let rows = [company('a', false)];
    const progress = vi.fn();
    const loadAll = vi.fn(async () => [
      company('a'),
      company('b'),
      company('other'),
    ]);
    const load = createCrmExportLoader(
      source({
        data: () => rows,
        hasNextPage: () => next,
        fetchNextPage: async () => {
          rows = [...rows, company('b')];
          next = false;
        },
      }),
      loadAll,
      isCompany
    );
    const result = load('current', new AbortController().signal, progress);
    await vi.runAllTimersAsync();
    expect((await result).companies).toEqual([company('a'), company('b')]);
    expect(progress).toHaveBeenCalledWith(2);
    expect(loadAll).toHaveBeenCalledOnce();
  });
  it('rejects failed pagination instead of downloading a partial view', async () => {
    vi.useFakeTimers();
    let error: Error | undefined;
    const loadAll = vi.fn();
    const load = createCrmExportLoader(
      source({
        error: () => error,
        hasNextPage: () => true,
        fetchNextPage: async () => {
          error = new Error('offline');
        },
      }),
      loadAll,
      isCompany
    );
    const result = expect(
      load('current', new AbortController().signal, vi.fn())
    ).rejects.toThrow('entire view');
    await vi.runAllTimersAsync();
    await result;
    expect(loadAll).not.toHaveBeenCalled();
  });
  it('stops while waiting for an in-flight view request when cancelled', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchNextPage = vi.fn();
    const load = createCrmExportLoader(
      source({ isFetching: () => true, fetchNextPage }),
      vi.fn(),
      isCompany
    );
    const result = expect(
      load('current', controller.signal, vi.fn())
    ).rejects.toThrow();
    controller.abort();
    await vi.runAllTimersAsync();
    await result;
    expect(fetchNextPage).not.toHaveBeenCalled();
  });
});
