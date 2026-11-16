import { Telemetry } from '@macro-inc/observability';
import { isCurrentQueryAccount } from '@queries/auth/account-scope';
import { useQueryAccount } from '@queries/auth/use-query-account';
import { createContactReferenceReader } from '@queries/contacts/reference-reader';
import { useContactDirectoryScope } from '@queries/contacts/use-directory';
import { dcsCompletion } from '@service-cognition/client';
import { err, ok, type Result, ResultAsync } from 'neverthrow';
import { onCleanup } from 'solid-js';
import {
  type AiTaskFilterCatalog,
  type AiTaskFilterPlan,
  buildAiTaskFilterRequest,
  parseAiTaskFilterResponse,
  resolveAiTaskFilterPlan,
} from '../filters/ai-task-filter';
import { TASK_VIEWER } from '../filters/task-facets';

export type AiTaskFilterPlanError =
  | { code: 'UNAVAILABLE' }
  | { code: 'UNREADABLE' }
  | { code: 'UNRESOLVED_PEOPLE' }
  | { code: 'STALE' }
  | { code: 'NO_FILTERS'; unresolved?: string };

type ResolvePeople = (
  labels: string[]
) => Promise<Result<Map<string, string>, AiTaskFilterPlanError>>;

/** Extract references first, then resolve their complete evidence separately. */
export async function requestAiTaskFilterPlan(
  query: string,
  catalog: AiTaskFilterCatalog,
  people: ResolvePeople,
  isCurrent: () => boolean
): Promise<Result<AiTaskFilterPlan, AiTaskFilterPlanError>> {
  return Telemetry.span('tasks.plan_filters', async (span) => {
    if (!isCurrent()) return err({ code: 'STALE' });
    const completion = await dcsCompletion(
      buildAiTaskFilterRequest(query, catalog)
    );
    if (!isCurrent()) return err({ code: 'STALE' });
    if (completion.isErr()) {
      span.error('Task filter extraction failed');
      return err({ code: 'UNAVAILABLE' });
    }
    const reply = parseAiTaskFilterResponse(
      completion.value.choices[0]?.message?.content
    );
    if (!reply) return err({ code: 'UNREADABLE' });
    const labels = [...reply.assignees, ...reply.createdBy]
      .map((value) => value.trim())
      .filter((value) => value !== TASK_VIEWER);
    span.setAttr('contacts.reference_count', labels.length);
    const resolved = labels.length
      ? await people(labels)
      : ok(new Map<string, string>());
    if (!isCurrent()) return err({ code: 'STALE' });
    if (resolved.isErr()) return err(resolved.error);
    const parsed = resolveAiTaskFilterPlan(reply, catalog, (label) =>
      resolved.value.get(label)
    );
    if (parsed.ok) return ok(parsed.plan);
    if (parsed.error === 'UNRESOLVED_PEOPLE')
      return err({ code: 'UNRESOLVED_PEOPLE' });
    return err({ code: 'NO_FILTERS', unresolved: parsed.unresolved });
  });
}

/** One reader belongs to this control; no inferred label history enters QueryCache.
 * Account/session, host generation and caller navigation fences remain independent. */
export function useAiTaskFilterPlan() {
  const account = useQueryAccount();
  const directory = useContactDirectoryScope();
  const reader = createContactReferenceReader();
  let pending: AbortController | undefined;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    pending?.abort();
    reader.dispose();
  });
  return async (
    query: string,
    catalog: AiTaskFilterCatalog,
    sameInput: () => boolean
  ) => {
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    const owner = account();
    const scope = directory();
    const isCurrent = () =>
      !disposed &&
      !controller.signal.aborted &&
      !!owner &&
      scope.userId === owner.userId &&
      isCurrentQueryAccount(owner) &&
      sameInput();
    const result = await requestAiTaskFilterPlan(
      query,
      catalog,
      async (labels) => {
        if (!isCurrent() || !owner) return err({ code: 'STALE' });
        const read = await ResultAsync.fromPromise(
          reader.read(
            owner.userId,
            scope.host,
            {
              labels,
              matching: 'preferFullName',
              excludeSecondaryInboxes: false,
            },
            controller.signal
          ),
          (): AiTaskFilterPlanError => ({ code: 'UNAVAILABLE' })
        );
        if (!isCurrent()) return err({ code: 'STALE' });
        if (read.isErr()) return err(read.error);
        const ids = new Map<string, string>();
        read.value.matches.forEach((match, index) => {
          if (match.complete && match.people.length === 1)
            ids.set(labels[index], match.people[0].userId);
        });
        return ok(ids);
      },
      isCurrent
    );
    if (pending === controller) pending = undefined;
    return result;
  };
}
