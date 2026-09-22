import type { CrmCompanyEntity } from '@entity/types/entity';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSetCompanyPropertyAction } from './make-set-company-property-action';

const mocks = vi.hoisted(() => ({
  loading: true,
  property: { propertyDefinitionId: 'custom-team-stage' },
  open: vi.fn(),
}));
vi.mock('@app/features/property/editor/state/propertyEditor', () => ({
  openPropertyEditor: mocks.open,
}));
vi.mock('@companies/crm/deal-stages', () => ({
  useDealStages: () => ({
    isLoading: () => mocks.loading,
    stageProperty: () => mocks.property,
  }),
}));
vi.mock('@entity/extractors-property', () => ({
  buildCompanyDefaultProperties: () => [],
}));

const company: CrmCompanyEntity = {
  type: 'crm_company',
  id: 'company',
  name: 'Company',
  ownerId: 'owner',
  teamId: 'team',
  hidden: false,
  domains: [],
};

beforeEach(() => {
  mocks.loading = true;
  mocks.open.mockClear();
});

describe('company property actions with lazy stage metadata', () => {
  it('does not open the editor with default stages while team definitions are pending', () => {
    const action = makeSetCompanyPropertyAction();
    expect(action.canExecute(company)).toBe(false);
    action.execute([company], 'stage');
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('uses the active team definition once it is ready', () => {
    const action = makeSetCompanyPropertyAction();
    mocks.loading = false;
    expect(action.canExecute(company)).toBe(true);
    action.execute([company], 'stage');
    expect(mocks.open).toHaveBeenCalledWith(
      [company],
      'direct',
      mocks.property
    );
  });
});
