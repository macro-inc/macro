import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { GraphqlEntityType } from '@service-storage/graphql/generated/graphql';
import { match } from 'ts-pattern';

export function displayEntityType(
  entityType: GraphqlEntityType
): EntityType | undefined {
  return match<GraphqlEntityType, EntityType | undefined>(entityType)
    .with('DOCUMENT', () => 'DOCUMENT')
    .with('PROJECT', () => 'PROJECT')
    .with('CHAT', () => 'CHAT')
    .with('EMAIL_THREAD', () => 'THREAD')
    .with('CHANNEL', () => 'CHANNEL')
    .with('USER', () => 'USER')
    .otherwise(() => undefined);
}
