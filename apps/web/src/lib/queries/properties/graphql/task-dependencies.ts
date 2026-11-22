import { catchToResult } from '@core/util/result';
import type { TaskDependencyRecipe } from '@graphql-cache/authority.generated';
import {
  readRecordsByKeys,
  selectRecords,
} from '@graphql-cache/exchange/record-selection';
import type { CacheHost } from '@graphql-cache/host/types';
import { Telemetry } from '@macro-inc/observability';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { SoupPropertyFieldsFragment } from '@service-storage/graphql/generated/graphql';
import {
  RepairTaskDependenciesDocument,
  TaskDependencyStateFieldsFragmentDoc,
} from '@service-storage/graphql/generated/graphql';
import type { Client } from '@urql/core';

const DEPENDS_ON = SYSTEM_PROPERTY_IDS.DEPENDS_ON;
const BLOCKING = SYSTEM_PROPERTY_IDS.BLOCKING;
const STATUS = SYSTEM_PROPERTY_IDS.STATUS;

export function isTaskDependencyProperty(definitionId: string): boolean {
  return (
    definitionId === DEPENDS_ON ||
    definitionId === BLOCKING ||
    definitionId === STATUS
  );
}

function references(
  property: SoupPropertyFieldsFragment | undefined
): string[] {
  const value = property?.value;
  if (value?.__typename !== 'GraphqlEntityReferencePropertyValue') return [];
  return value.references.map((reference) => reference.entityId);
}

/** Author only the replacement assignment; the engine rebases reciprocal effects. */
export function taskDependencyRecipe(
  taskId: string,
  property: SoupPropertyFieldsFragment
): TaskDependencyRecipe {
  const definition = property.propertyDefinitionId;
  if (definition === DEPENDS_ON) {
    return {
      taskId,
      change: { kind: 'dependsOn', targetIds: references(property) },
    };
  }
  if (definition === BLOCKING) {
    return {
      taskId,
      change: { kind: 'blocking', targetIds: references(property) },
    };
  }
  if (definition !== STATUS)
    throw new TypeError('unsupported task dependency property');
  return {
    taskId,
    change: {
      kind: 'status',
      optionIds:
        property.value?.__typename === 'GraphqlSelectOptionPropertyValue'
          ? property.value.optionIds
          : [],
    },
  };
}

/** Resolve the first known open blocker for a rejected completion's recovery action. */
export async function readFirstOpenBlocker(
  host: CacheHost | undefined,
  taskId: string
): Promise<string | undefined> {
  if (!host?.readRecordsByKeys) return undefined;
  const selected = await catchToResult(
    async () =>
      await readRecordsByKeys(
        host,
        selectRecords(TaskDependencyStateFieldsFragmentDoc),
        [`GraphqlTaskDependencyState:${taskId}`]
      )
  );
  if (selected.isErr()) return undefined;
  return selected.value.records[0]?.record.openBlockerIds[0];
}

/** A failed effects read never turns a confirmed write into a reported write failure. */
export async function repairTaskDependencies(
  client: Client,
  taskId: string
): Promise<void> {
  const repair = await catchToResult(
    async () =>
      await client
        .query(
          RepairTaskDependenciesDocument,
          {
            input: { entityType: 'DOCUMENT', entityId: taskId },
          },
          { requestPolicy: 'network-only' }
        )
        .toPromise()
  );
  const error = repair.isErr() ? repair.error : repair.value.error;
  if (error)
    Telemetry.error(error, {
      surface: 'task-dependencies',
      'entity.id': taskId,
    });
}
