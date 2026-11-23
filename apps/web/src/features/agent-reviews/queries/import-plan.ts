import type { ImportEntity, NotionImportReport } from '@queries/import';
import { match } from 'ts-pattern';
import { z } from 'zod';
import type {
  ImportDraft,
  ImportPlanEntry,
  ImportProgress,
} from '../core/import-plan';

const planMetadataSchema = z.object({
  title: z.string(),
  plan: z.object({
    dependencyOf: z.array(z.string()).optional(),
    inlineOn: z.array(z.string()).optional(),
    // Absent while planning has not decided the object yet.
    decision: z.enum(['copy', 'tasks', 'skip', 'hand']).nullish(),
    reason: z.string().nullish(),
    rows: z.number().nullish(),
    sampleTitles: z.array(z.string()).nullish(),
    taskFields: z
      .object({
        status: z.string().nullish(),
        priority: z.string().nullish(),
        due: z.string().nullish(),
        assignee: z.string().nullish(),
      })
      .nullish(),
    shared: z.boolean().nullish(),
    sharedReason: z.string().nullish(),
    shareable: z.boolean().nullish(),
    alreadyImported: z
      .object({
        by: z.string(),
        entityId: z.string(),
        entityType: z.string(),
      })
      .nullish(),
  }),
});

/** The workspace plan rows presented by one review, in ledger order. */
export function decodePlanEntries(
  entities: ImportEntity[],
  reviewId: string
): ImportPlanEntry[] {
  const titles = new Map(
    entities
      .filter((entity) => entity.review_id === reviewId)
      .flatMap((entity) => {
        const metadata = planMetadataSchema.safeParse(entity.metadata);
        return metadata.success
          ? [[entity.foreign_id, metadata.data.title] as const]
          : [];
      })
  );
  return entities.flatMap((entity): ImportPlanEntry[] => {
    if (
      !['notion', 'linear', 'jira'].includes(entity.source) ||
      entity.review_id !== reviewId
    )
      return [];
    const metadata = planMetadataSchema.safeParse(entity.metadata);
    if (!metadata.success) return [];
    const plan = metadata.data.plan;
    const linkedFrom =
      plan.dependencyOf?.map((id) => titles.get(id) ?? 'a row page') ?? [];
    const dependency = linkedFrom.length > 0 ? { linkedFrom } : {};
    const inlineOn =
      plan.inlineOn?.map((id) => titles.get(id) ?? 'a row page') ?? [];
    const placement = inlineOn.length > 0 ? { inlineOn } : {};
    return [
      {
        ...dependency,
        ...placement,
        id: entity.id,
        parentId: entity.parent_id ?? null,
        kind: match(entity.kind)
          .with('data_source', () => 'database' as const)
          .with('issue', 'jira_issue', () => 'task' as const)
          .with(
            'project',
            'jira_project',
            'jira_epic',
            () => 'project' as const
          )
          .otherwise(() => 'page' as const),
        title: metadata.data.title,
        decision: plan.decision ?? null,
        reason: plan.reason ?? null,
        rows: plan.rows ?? null,
        sampleTitles: plan.sampleTitles ?? [],
        taskFields: plan.taskFields
          ? {
              status: plan.taskFields.status ?? null,
              priority: plan.taskFields.priority ?? null,
              due: plan.taskFields.due ?? null,
              assignee: plan.taskFields.assignee ?? null,
            }
          : null,
        status: entity.status,
        error: entity.last_error ?? null,
        shared: plan.shared ?? false,
        sharedReason: plan.sharedReason ?? null,
        shareable: plan.shareable ?? false,
        alreadyImported: plan.alreadyImported ?? null,
      },
    ];
  });
}

export function decodeImportProgress(
  report: NotionImportReport,
  source: ImportDraft['source'] = 'notion'
): ImportProgress {
  return {
    warnings: report.warnings ?? [],
    details: report.details,
    confirmed: report.confirmed,
    reviewId: report.reviewId ?? null,
    status: report.status ?? null,
    error: report.error ?? null,
    scanned: report.scanned
      ? {
          pages: report.scanned.pages,
          databases: report.scanned.dataSources,
        }
      : null,
    onTeam: report.onTeam ?? false,
    counts: {
      pages: source === 'notion' ? report.pages : (report.issues ?? 0),
      databases:
        source === 'notion' ? report.dataSources : (report.projects ?? 0),
      copy: report.copy,
      tasks: report.tasks,
      skip: report.skip,
      hand: report.hand,
      deciding: report.deciding ?? 0,
    },
    imported: report.imported,
    waiting: report.waiting,
    writing: report.writing,
    failures: (report.failures ?? []).map((item) => ({
      id: item.importId,
      title: item.title,
      reason: item.reason ?? '',
    })),
  };
}
