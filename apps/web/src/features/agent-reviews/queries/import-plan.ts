import type { ImportEntity, NotionImportReport } from '@queries/import';
import { z } from 'zod';
import type {
  ImportDraft,
  ImportPlanEntry,
  ImportProgress,
} from '../core/import-plan';

const importDraftSchema = z.object({
  source: z.literal('notion'),
  excluded: z.array(z.string()).optional(),
  shared: z.array(z.string()).optional(),
  personal: z.array(z.string()).optional(),
});

/** The saved draft of an import review; `undefined` when it is not one. */
export function decodeImportDraft(draft: unknown): ImportDraft | undefined {
  const parsed = importDraftSchema.safeParse(draft);
  if (!parsed.success) return undefined;
  return {
    source: 'notion',
    excluded: parsed.data.excluded ?? [],
    shared: parsed.data.shared ?? [],
    personal: parsed.data.personal ?? [],
  };
}

const planMetadataSchema = z.object({
  title: z.string(),
  plan: z.object({
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

/** The Notion plan rows presented by one review, in ledger order. */
export function decodePlanEntries(
  entities: ImportEntity[],
  reviewId: string
): ImportPlanEntry[] {
  return entities.flatMap((entity): ImportPlanEntry[] => {
    if (entity.source !== 'notion' || entity.review_id !== reviewId) return [];
    const metadata = planMetadataSchema.safeParse(entity.metadata);
    if (!metadata.success) return [];
    const plan = metadata.data.plan;
    return [
      {
        id: entity.id,
        parentId: entity.parent_id ?? null,
        kind: entity.kind === 'data_source' ? 'database' : 'page',
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
  report: NotionImportReport
): ImportProgress {
  return {
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
      pages: report.pages,
      databases: report.dataSources,
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
