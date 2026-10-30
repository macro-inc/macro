import { verifyBlockName } from '@core/constant/allBlocks';
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import {
  getItemPreview,
  type ItemEntity,
  isAccessiblePreviewItem,
} from '@queries/preview';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import { scheduledActionClient } from '@service-scheduled-action/client';
import type {
  CreateScheduledAction,
  RoutineTemplate,
  ScheduledAction,
} from '@service-scheduled-action/generated/schemas';
import { blockNameToItemType } from '@service-storage/itemType';
import {
  queryOptions,
  useMutation,
  useQueries,
  useQuery,
} from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { templateShareBody } from '../core/template';
import { scheduledActionKeys } from './keys';
import { draftFromSchedule } from './routine-draft';
import { routineQueryOptions } from './routines';
import { invalidateSchedules } from './schedules';

/** A routine that isn't shared has no template: `null`, not an error. */
async function fetchTemplate(
  scheduleId: string
): Promise<RoutineTemplate | null> {
  const result = await scheduledActionClient.getTemplate(scheduleId);
  if (
    result.isErr() &&
    result.error.some((error) => error.code === 'NOT_FOUND')
  )
    return null;
  return throwOnErr(async () => result);
}

// Cached past unmount; closes over the resolved schedule id only.
export function routineTemplateQueryOptions(
  scheduleId: string | undefined,
  enabled = true
) {
  return queryOptions({
    queryKey: scheduledActionKeys.template({
      scheduleId: scheduleId ?? '__none__',
    }).queryKey,
    enabled: enabled && Boolean(scheduleId),
    queryFn: () => fetchTemplate(scheduleId!),
  });
}

export function useRoutineTemplateQuery(
  scheduleId: Accessor<string | undefined>,
  enabled: Accessor<boolean> = () => true
) {
  return useQuery(() => routineTemplateQueryOptions(scheduleId(), enabled()));
}

function setTemplate(scheduleId: string, template: RoutineTemplate | null) {
  queryClient.setQueryData(
    scheduledActionKeys.template({ scheduleId }).queryKey,
    template
  );
}

/**
 * Shares a routine as a template, or brings its template up to date with the
 * routine's saved setup. Repeating it publishes the same snapshot again.
 */
export async function publishRoutineTemplate(
  scheduleId: string
): Promise<RoutineTemplate> {
  const [routine, shared] = await Promise.all([
    queryClient.fetchQuery(routineQueryOptions(scheduleId)),
    queryClient.fetchQuery(routineTemplateQueryOptions(scheduleId)),
  ]);
  const body = templateShareBody({
    draft: draftFromSchedule(routine),
    authorId: routine.owner,
    shared,
  });
  const template = await throwOnErr(() =>
    scheduledActionClient.shareTemplate({ scheduleId, body })
  );
  setTemplate(scheduleId, template);
  return template;
}

export function useUnshareTemplateMutation(
  callbacks?: MutationCallbacks<void, Error, { scheduleId: string }>
) {
  return useMutation(() => ({
    mutationFn: (args: { scheduleId: string }) =>
      throwOnErr(() => scheduledActionClient.unshareTemplate(args)),
    ...withCallbacks(
      { onSuccess: (_result, { scheduleId }) => setTemplate(scheduleId, null) },
      callbacks
    ),
  }));
}

export function useActivateTemplateMutation(
  callbacks?: MutationCallbacks<
    ScheduledAction,
    Error,
    { templateId: string; body: CreateScheduledAction }
  >
) {
  return useMutation(() => ({
    mutationFn: (args: { templateId: string; body: CreateScheduledAction }) =>
      throwOnErr(() => scheduledActionClient.activateTemplate(args)),
    ...withCallbacks(
      {
        onSuccess: async (_routine, { templateId }) => {
          await Promise.all([
            invalidateSchedules(),
            queryClient.invalidateQueries({
              queryKey: scheduledActionKeys.template({
                scheduleId: templateId,
              }).queryKey,
            }),
          ]);
        },
      },
      callbacks
    ),
  }));
}

// Cached past unmount; closes over the resolved item only.
function referenceAccessQueryOptions(item: ItemEntity) {
  return queryOptions({
    queryKey: scheduledActionKeys.referenceAccess({
      itemId: item.id,
      itemType: item.type ?? 'document',
    }).queryKey,
    queryFn: async () => isAccessiblePreviewItem(await getItemPreview(item)),
  });
}

/**
 * Whether the viewer can open each item a template mentions, keyed by item
 * ID. Items still loading are absent.
 */
export function useReferenceAccess(
  items: Accessor<readonly { id: string; blockName: string }[]>
): Accessor<ReadonlyMap<string, boolean>> {
  const queries = useQueries(() => ({
    queries: items().map((item) =>
      referenceAccessQueryOptions({
        id: item.id,
        type: blockNameToItemType(verifyBlockName(item.blockName)),
      })
    ),
  }));
  return () =>
    new Map(
      items().flatMap((item, index) => {
        const query = queries[index];
        return query?.isSuccess ? [[item.id, query.data] as const] : [];
      })
    );
}
