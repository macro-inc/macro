import type { CrmViewConfig } from '@companies/crm/saved-views';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mobile: true,
  apply: vi.fn(),
  config: {
    kind: 'crm',
    viewMode: 'board',
    searchText: 'Acme',
  } as CrmViewConfig,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.mobile,
}));
vi.mock('@companies/crm/saved-views', () => ({
  usePersonalCrmViews: () => ({
    isLoading: () => false,
    defaultView: () => ({ config: mocks.config }),
  }),
  useTeamCrmViews: () => ({
    isLoading: () => false,
    defaultView: () => undefined,
  }),
}));
vi.mock(
  '@app/features/next-soup/soup-view/views/companies/use-apply-crm-view',
  () => ({
    useApplyCrmView: () => mocks.apply,
  })
);

import { CrmDefaultViewLoader } from './CrmDefaultView';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe('CRM default saved layout', () => {
  it('uses a list on mobile while retaining the saved filters', () => {
    mocks.mobile = true;
    render(() => <CrmDefaultViewLoader />);
    expect(mocks.apply).toHaveBeenCalledWith({
      ...mocks.config,
      viewMode: 'list',
    });
    expect(mocks.config.viewMode).toBe('board');
  });
  it('retains the saved desktop layout', () => {
    mocks.mobile = false;
    render(() => <CrmDefaultViewLoader />);
    expect(mocks.apply).toHaveBeenCalledWith(mocks.config);
  });
});
