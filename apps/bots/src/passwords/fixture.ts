import type { Folder, Item, PasswordStorage, Readiness } from './storage';

export const sampleTeam = 'sample-team';
export const sampleTeamName = 'Sample Team';

const folders: Folder[] = [
  { id: 'engineering', name: 'Engineering' },
  { id: 'finance', name: 'Finance' },
  { id: 'design', name: 'Design' },
  { id: 'operations', name: 'Operations' },
];

const defaults = {
  teamId: sampleTeam,
  creator: 'Team admin',
  sharedWithTeam: true,
  agentCount: 0,
  version: 1,
};

const seed: Omit<Item, 'canEdit'>[] = [
  {
    ...defaults,
    id: 'docs',
    kind: 'login',
    name: 'Docs Repository',
    folderId: 'engineering',
    creator: 'Item creator',
    sharedWithTeam: false,
    fields: { username: 'docs-bot', website: 'https://docs.example.com' },
    filled: { password: true, notes: true },
  },
  {
    ...defaults,
    id: 'issue-tracker',
    kind: 'login',
    name: 'Issue Tracker',
    folderId: 'engineering',
    agentCount: 2,
    fields: { username: 'triage-bot' },
    filled: { password: true },
  },
  {
    ...defaults,
    id: 'design-library',
    kind: 'login',
    name: 'Design Library',
    folderId: 'design',
    agentCount: 1,
    fields: { username: 'design-bot' },
    filled: { password: true },
  },
  {
    ...defaults,
    id: 'feedback',
    kind: 'login',
    name: 'Feedback Portal',
    folderId: 'operations',
    sharedWithTeam: false,
    fields: { username: 'feedback-bot' },
    filled: { password: true },
  },
  {
    ...defaults,
    id: 'ops-card',
    kind: 'card',
    name: 'Design Ops Virtual Card',
    folderId: 'finance',
    fields: { cardholder: sampleTeamName, expiration: '08 / 2028' },
    filled: { cardNumber: true, securityCode: true, notes: true },
    fixtureUseWhen: 'Use for monthly design tooling renewals.',
  },
  {
    ...defaults,
    id: 'webhook',
    kind: 'api',
    name: 'Release Webhook API',
    folderId: 'engineering',
    fields: {
      website: 'https://api.example.com/webhooks',
      environment: 'Staging',
    },
    filled: { apiKey: true, apiSecret: true },
  },
];

export function createPasswordFixture(query: string): PasswordStorage {
  const params = new URLSearchParams(query);
  const actor = params.get('actor') ?? 'admin';
  const admin = actor === 'admin';
  const creator = admin ? 'Team admin' : 'Item creator';
  const fixture = params.get('case');
  let readiness: Readiness =
    fixture === 'empty' || fixture === 'incompatible' || fixture === 'recovery'
      ? 'empty'
      : 'ready';
  let items = readiness === 'ready' ? [...seed] : [];
  let nextId = 1;

  const canEdit = (item: Omit<Item, 'canEdit'>) =>
    admin || (actor === 'creator' && item.creator === creator);
  const canCreate = () =>
    admin && (readiness === 'empty' || readiness === 'ready');

  const visible = (team: string) =>
    items.filter(
      (item) => team === item.teamId && (item.sharedWithTeam || canEdit(item))
    );

  return {
    read(team) {
      return {
        role: admin ? 'Team admin' : 'Team member',
        readiness,
        canCreate: team === sampleTeam && canCreate(),
        folders: team === sampleTeam ? folders : [],
        items: visible(team).map(
          ({ id, kind, name, folderId, creator, agentCount }) => ({
            id,
            kind,
            name,
            folderId,
            creator,
            agentCount,
          })
        ),
      };
    },
    detail(team, id) {
      const item = visible(team).find((entry) => entry.id === id);
      if (item) return { ...item, canEdit: canEdit(item) };
    },
    save(
      team,
      { id, name, folderId, fields, filled, fixtureUseWhen, ...intent }
    ) {
      const title = name.trim();
      if (
        team !== sampleTeam ||
        !title ||
        (folderId && !folders.some((folder) => folder.id === folderId))
      ) {
        return;
      }

      const details = { name: title, folderId, fields, filled };
      if ('expectedVersion' in intent) {
        const existing = visible(team).find((item) => item.id === id);
        if (
          !existing ||
          !canEdit(existing) ||
          existing.version !== intent.expectedVersion
        ) {
          return;
        }

        items = items.map((item) =>
          item === existing
            ? {
                ...item,
                ...details,
                version: item.version + 1,
                fixtureUseWhen:
                  item.kind === 'card' ? fixtureUseWhen : undefined,
              }
            : item
        );
        return id;
      }

      if (!('kind' in intent) || !canCreate()) return;
      if (intent.kind === 'verification_code' && !filled.totp) return;

      if (
        readiness === 'empty' &&
        (fixture === 'incompatible' || fixture === 'recovery')
      ) {
        readiness = fixture;
        return;
      }

      const newId = `local-${nextId++}`;
      items = [
        {
          ...defaults,
          ...details,
          id: newId,
          kind: intent.kind,
          sharedWithTeam: !intent.private,
          fixtureUseWhen: intent.kind === 'card' ? fixtureUseWhen : undefined,
        },
        ...items,
      ];
      readiness = 'ready';
      return newId;
    },
  };
}
