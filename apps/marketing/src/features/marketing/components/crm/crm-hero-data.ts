import type { HomepagePersonId } from '../../core/homepage-demo-people';
import type { DealStage } from '../../core/workspace-fixtures';

export type HeroDeal = {
  companyId: string;
  stage: DealStage;
  owner: HomepagePersonId | '';
  revenue: string;
};

/** Fictional pipelines. Deals retain their own fields even for the same company. */
export const crmHeroPipelines: {
  id: string;
  name: string;
  sharing: string;
  stages: DealStage[];
  deals: HeroDeal[];
}[] = [
  {
    id: 'new-business',
    name: 'New business',
    sharing: 'Team',
    stages: ['Lead', 'Qualified', 'Demo', 'Trial', 'Negotiation', 'Customer'],
    deals: [
      {
        companyId: 'northstar',
        stage: 'Lead',
        owner: 'jacob',
        revenue: '12000',
      },
      { companyId: 'harbor', stage: 'Lead', owner: 'julia', revenue: '' },
      { companyId: 'ridgeline', stage: 'Lead', owner: '', revenue: '' },
      { companyId: 'copperleaf', stage: 'Lead', owner: 'teo', revenue: '4800' },
      { companyId: 'orbit', stage: 'Qualified', owner: 'teo', revenue: '6000' },
      {
        companyId: 'tidewater',
        stage: 'Qualified',
        owner: 'jacob',
        revenue: '',
      },
      {
        companyId: 'fernway',
        stage: 'Qualified',
        owner: 'julia',
        revenue: '8400',
      },
      { companyId: 'meadow', stage: 'Demo', owner: 'jacob', revenue: '18000' },
      {
        companyId: 'bluebird',
        stage: 'Demo',
        owner: 'julia',
        revenue: '21600',
      },
      { companyId: 'sable', stage: 'Demo', owner: 'teo', revenue: '' },
      { companyId: 'lumen', stage: 'Trial', owner: 'julia', revenue: '9000' },
      {
        companyId: 'foxglove',
        stage: 'Trial',
        owner: 'jacob',
        revenue: '7200',
      },
      {
        companyId: 'northwind',
        stage: 'Negotiation',
        owner: 'jacob',
        revenue: '32000',
      },
      {
        companyId: 'granite',
        stage: 'Negotiation',
        owner: 'gabriel',
        revenue: '14400',
      },
      {
        companyId: 'relay',
        stage: 'Customer',
        owner: 'julia',
        revenue: '24000',
      },
    ],
  },
  {
    id: 'studios',
    name: 'Studio partnerships',
    sharing: 'Team',
    stages: ['Lead', 'Qualified', 'Demo', 'Negotiation', 'Customer'],
    deals: [
      { companyId: 'ridgeline', stage: 'Lead', owner: 'teo', revenue: '12000' },
      { companyId: 'cedar', stage: 'Lead', owner: '', revenue: '' },
      {
        companyId: 'sable',
        stage: 'Qualified',
        owner: 'julia',
        revenue: '9600',
      },
      {
        companyId: 'foxglove',
        stage: 'Demo',
        owner: 'jacob',
        revenue: '14400',
      },
      {
        companyId: 'meadow',
        stage: 'Negotiation',
        owner: 'julia',
        revenue: '36000',
      },
    ],
  },
  {
    id: 'renewals',
    name: 'Q4 renewals',
    sharing: 'Team',
    stages: ['Qualified', 'Negotiation', 'Customer', 'Churned'],
    deals: [
      {
        companyId: 'relay',
        stage: 'Qualified',
        owner: 'julia',
        revenue: '28800',
      },
      {
        companyId: 'pallet',
        stage: 'Qualified',
        owner: 'teo',
        revenue: '7200',
      },
      {
        companyId: 'fieldnote',
        stage: 'Negotiation',
        owner: 'jacob',
        revenue: '12000',
      },
      {
        companyId: 'lumen',
        stage: 'Customer',
        owner: 'julia',
        revenue: '10800',
      },
      { companyId: 'cedar', stage: 'Churned', owner: 'jacob', revenue: '4800' },
    ],
  },
  {
    id: 'expansion',
    name: 'Team expansion',
    sharing: 'Private',
    stages: ['Lead', 'Qualified', 'Demo', 'Negotiation', 'Customer'],
    deals: [
      { companyId: 'pallet', stage: 'Lead', owner: 'jacob', revenue: '3600' },
      {
        companyId: 'fieldnote',
        stage: 'Qualified',
        owner: 'jacob',
        revenue: '4800',
      },
      {
        companyId: 'relay',
        stage: 'Negotiation',
        owner: 'jacob',
        revenue: '12000',
      },
    ],
  },
];

export const crmHeroLists = [
  {
    id: 'onboarding',
    name: 'Onboarding this month',
    companyIds: ['relay', 'pallet', 'fieldnote'],
  },
  {
    id: 'design-partners',
    name: 'Design partners',
    companyIds: ['meadow', 'sable', 'foxglove', 'ridgeline'],
  },
  {
    id: 'follow-up',
    name: 'Follow up this week',
    companyIds: ['northstar', 'harbor', 'lumen', 'granite', 'bluebird'],
  },
];
