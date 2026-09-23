import type { CrmCompanyEntity } from '@entity/types/entity';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSetCompanyPropertyAction } from './make-set-company-property-action';

const mocks = vi.hoisted(() => ({
  loading: true,
  property: { propertyDefinitionId: 'custom-team-stage' },
  open: vi.fn(),
  defaults: vi.fn(),
  stageProperty: vi.fn(),
}));
vi.mock('@app/features/property/editor/state/propertyEditor', () => ({
  openPropertyEditor: mocks.open,
}));
vi.mock('@companies/crm/deal-stages', () => ({
  useDealStages: () => ({
    isLoading: () => mocks.loading,
    stageProperty: mocks.stageProperty,
  }),
}));
vi.mock('@entity/extractors-property', () => ({
  buildCompanyDefaultProperties: mocks.defaults,
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
  vi.clearAllMocks();
  mocks.stageProperty.mockReturnValue(mocks.property);
  mocks.defaults.mockReturnValue([
    { propertyDefinitionId: SYSTEM_PROPERTY_IDS.COMPANY_OWNER },
    { propertyDefinitionId: SYSTEM_PROPERTY_IDS.REVENUE },
  ]);
});

describe('company property actions with lazy stage metadata', () => {
  it('does not open the editor with default stages while team definitions are pending', () => {
    const action = makeSetCompanyPropertyAction();
    expect(action.canExecute(company, 'stage')).toBe(false);
    action.execute([company], 'stage');
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it.each([
    ['owner', SYSTEM_PROPERTY_IDS.COMPANY_OWNER],
    ['revenue', SYSTEM_PROPERTY_IDS.REVENUE],
  ] as const)(
    'allows %s edits while stage metadata is pending',
    (field, definitionId) => {
      const action = makeSetCompanyPropertyAction();
      expect(action.canExecute(company, field)).toBe(true);
      action.execute([company], field);
      expect(mocks.open).toHaveBeenCalledWith([company], 'direct', {
        propertyDefinitionId: definitionId,
      });
      expect(mocks.stageProperty).not.toHaveBeenCalled();
    }
  );

  it('uses the active team definition once it is ready', () => {
    const action = makeSetCompanyPropertyAction();
    mocks.loading = false;
    expect(action.canExecute(company, 'stage')).toBe(true);
    action.execute([company], 'stage');
    expect(mocks.open).toHaveBeenCalledWith(
      [company],
      'direct',
      mocks.property
    );
  });
});
