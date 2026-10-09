import {
  buildSchema,
  getNamedType,
  getNullableType,
  isCompositeType,
  isListType,
  Kind,
  parse,
  TypeInfo,
  visit,
  visitWithTypeInfo,
} from 'graphql';
import { expect, it } from 'vitest';
import membershipSource from '../../../../../crates/client/cache-core/src/membership.rs?raw';
import schemaSource from '../../../../../static_assets/schema.graphql?raw';

/**
 * Who maintains the members of every list of objects the app selects:
 * - `relation`: cache-core derives membership from child records (declared in
 *   `crates/client/cache-core/src/membership.rs`);
 * - `predicate`: a maintained view over a local index keeps membership;
 * - `opaque`: the list is the server's answer (network writes, link recipes,
 *   refetches); the reason names why, or what a conversion needs.
 * New list fields must choose one, like mutations in mutation-coverage.
 */
type Membership = 'relation' | 'predicate' | 'opaque';
const PROPERTIES =
  'opaque: entity properties; GraphqlProperty must expose entityType/entityId before this can be a relation';
const MUTATION_RESULT =
  'opaque: mutation result; never read back from the cache';
const EVENT_BATCH =
  'opaque: subscription event batch, applied to records, never read back';
const EMBEDDED = 'opaque: embedded values of the parent record';

const membership = {
  'CompleteMutationRoot.reorderFavorites': MUTATION_RESULT,
  'CompleteMutationRoot.updateEntityPropertyOptions': MUTATION_RESULT,
  'CompleteMutationRoot.updateNotifications': MUTATION_RESULT,
  'CompleteMutationRoot.updateNotificationsForEntity': MUTATION_RESULT,
  'CompleteSubscriptionRoot.agentSessionLogAppended': EVENT_BATCH,
  'CompleteSubscriptionRoot.soupUpdates': EVENT_BATCH,
  'CompleteSubscriptionRoot.workFeedUpdates': EVENT_BATCH,
  'EntityMutationPayload.results': MUTATION_RESULT,
  'GraphqlActivityOverview.days': 'opaque: server aggregate by day',
  'GraphqlActivityOverview.topEntities': 'opaque: server ranking aggregate',
  'GraphqlActivityPage.items': 'opaque: server activity cursor page',
  'GraphqlAgentSessionLog.entries':
    'opaque: append-only session log; appends arrive by subscription',
  'GraphqlCalendar.defaultReminders': EMBEDDED,
  'GraphqlCalendarChanges.calendars':
    'opaque: calendar sync delta, folded into the range index',
  'GraphqlCalendarChanges.events':
    'opaque: calendar sync delta, folded into the range index',
  'GraphqlCalendarChanges.newWatermark': 'opaque: calendar sync metadata',
  'GraphqlCalendarEvent.attendees': EMBEDDED,
  'GraphqlCalendarEvent.sources': EMBEDDED,
  'GraphqlCalendarEventChange.occurrences':
    'opaque: calendar sync delta, folded into the range index',
  'GraphqlCalendarMutationPayload.occurrences': MUTATION_RESULT,
  'GraphqlCalendarOccurrence.overrideAttendees': EMBEDDED,
  'GraphqlCalendarOccurrencePage.nodes':
    'predicate: calendarRange derives viewport members from the local range index',
  'GraphqlCalendarOccurrencePage.watermark': 'opaque: calendar sync metadata',
  'GraphqlCalendarReminders.overrides': EMBEDDED,
  'GraphqlEntityReferencePropertyValue.references':
    'opaque: a property value the user edits as a whole',
  'GraphqlMailDraftState.drafts':
    'opaque: draft link recipes; a relation candidate keyed by thread',
  'GraphqlMutationSuccess.effects': MUTATION_RESULT,
  'GraphqlSoupAgentSession.properties': PROPERTIES,
  'GraphqlSoupBin.items':
    'opaque: grouped Soup bins stay server-grouped until grouped predicate views exist',
  'GraphqlSoupCalendarEvent.properties': PROPERTIES,
  'GraphqlSoupCall.guests': EMBEDDED,
  'GraphqlSoupCall.participants': EMBEDDED,
  'GraphqlSoupCall.properties': PROPERTIES,
  'GraphqlSoupChannel.notifications':
    'opaque: a keyed relation candidate (notifications by entity) once a loaded-window rule for limit exists',
  'GraphqlSoupChannel.participants':
    'opaque: server-owned channel membership and access',
  'GraphqlSoupChat.properties': PROPERTIES,
  'GraphqlSoupCrmCompany.properties': PROPERTIES,
  'GraphqlSoupDatabaseRow.properties': PROPERTIES,
  'GraphqlSoupDocument.properties': PROPERTIES,
  'GraphqlSoupEmailMessage.attachments': EMBEDDED,
  'GraphqlSoupEmailMessage.attachmentsDraft': EMBEDDED,
  'GraphqlSoupEmailMessage.attachmentsForwarded': EMBEDDED,
  'GraphqlSoupEmailMessage.bcc': EMBEDDED,
  'GraphqlSoupEmailMessage.cc': EMBEDDED,
  'GraphqlSoupEmailMessage.labels': EMBEDDED,
  'GraphqlSoupEmailMessage.to': EMBEDDED,
  'GraphqlSoupEmailThread.attachments':
    'opaque: server aggregate of the thread messages',
  'GraphqlSoupEmailThread.labels':
    'opaque: server aggregate of the thread messages',
  'GraphqlSoupEmailThread.messages':
    'opaque: server thread composition; drafts use link recipes',
  'GraphqlSoupEmailThread.participants':
    'opaque: server aggregate of the thread messages',
  'GraphqlSoupEmailThread.properties': PROPERTIES,
  'GraphqlSoupEntity.activity': 'opaque: server activity feed',
  'GraphqlSoupEntity.notifications':
    'opaque: a keyed relation candidate (notifications by entity) once a loaded-window rule for limit exists',
  'GraphqlSoupEntity.properties': PROPERTIES,
  'GraphqlSoupInitiative.properties': PROPERTIES,
  'GraphqlSoupProject.properties': PROPERTIES,
  'GraphqlUser.calendars': 'opaque: account calendars from calendar sync',
  'GraphqlUser.databaseActivity': 'opaque: server activity feed',
  'GraphqlUser.emailLinks': 'opaque: server-owned mail account links',
  'GraphqlUser.favorites':
    'relation: GraphqlFavorite records filtered by entity type and id, ordered by sortOrder',
  'GroupedSoup.bins':
    'opaque: grouped Soup bins stay server-grouped until grouped predicate views exist',
  'InitiativeSharePermission.channelSharePermissions': EMBEDDED,
  'SoupPage.items':
    'predicate: createSoupLiveQuery maintains members through the predicate index',
  'UndoWorkFeedItemsDonePayload.patches': MUTATION_RESULT,
  'WorkFeedItem.stacks': 'opaque: server-ranked work feed',
  'WorkFeedPage.entries': 'opaque: server-ranked work feed',
  'WorkFeedStack.notifications': 'opaque: server-ranked work feed',
} satisfies Record<string, `${Membership}: ${string}`>;

const schema = buildSchema(schemaSource);
const documents = import.meta.glob(
  '../service-clients/service-storage/graphql/*.graphql',
  { query: '?raw', import: 'default', eager: true }
);

/** `Parent.field` for every selected field whose value is a list of objects. */
function listFields(): string[] {
  const fields = new Set<string>();
  for (const source of Object.values(documents)) {
    const typeInfo = new TypeInfo(schema);
    visit(
      parse(String(source)),
      visitWithTypeInfo(typeInfo, {
        [Kind.FIELD]() {
          const parent = typeInfo.getParentType();
          const type = typeInfo.getType();
          if (!parent || !type) return;
          const nullable = getNullableType(type);
          if (isListType(nullable) && isCompositeType(getNamedType(nullable)))
            fields.add(`${parent.name}.${typeInfo.getFieldDef()?.name}`);
        },
      })
    );
  }
  return [...fields].sort();
}

const classified = (kind: Membership) =>
  Object.entries(membership)
    .filter(([, policy]) => policy.startsWith(`${kind}:`))
    .map(([field]) => field)
    .sort();

/** `Parent.field` pairs declared in cache-core's relation table. */
function declaredRelations(): string[] {
  const table = membershipSource.slice(
    membershipSource.indexOf('pub const RELATIONS'),
    membershipSource.indexOf('/// Stable index of a compiled relation')
  );
  return [
    ...table.matchAll(/parent_type: "(\w+)",\s*field: "(\w+)"/g),
  ]
    .map(([, parent, field]) => `${parent}.${field}`)
    .sort();
}

it('classifies the membership of every list field the app selects', () => {
  expect(listFields()).toEqual(Object.keys(membership).sort());
});

it('matches relation classifications to cache-core declarations', () => {
  expect(declaredRelations()).toEqual(classified('relation'));
  expect(classified('relation')).toEqual(['GraphqlUser.favorites']);
});
