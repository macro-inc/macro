import { dcsCompletion } from '@service-cognition/client';
import { err, ok, type Result } from 'neverthrow';
import {
  type AiTaskFilterCatalog,
  type AiTaskFilterPlan,
  buildAiTaskFilterRequest,
  parseAiTaskFilterResponse,
} from '../filters/ai-task-filter';

export type AiTaskFilterPlanError =
  /** The completion request itself failed. */
  | { code: 'UNAVAILABLE' }
  /** The model answered with something that is not the expected JSON. */
  | { code: 'UNREADABLE' }
  /** A valid answer that selects nothing; `unresolved` is the model's reason. */
  | { code: 'NO_FILTERS'; unresolved?: string };

/** Asks the model to turn a plain-English request into a task filter plan. */
export async function requestAiTaskFilterPlan(
  query: string,
  catalog: AiTaskFilterCatalog
): Promise<Result<AiTaskFilterPlan, AiTaskFilterPlanError>> {
  const completion = await dcsCompletion(
    buildAiTaskFilterRequest(query, catalog)
  );
  if (completion.isErr()) {
    console.error('AI task filter request failed', completion.error);
    return err({ code: 'UNAVAILABLE' });
  }

  const parsed = parseAiTaskFilterResponse(
    completion.value.choices[0]?.message?.content,
    catalog
  );
  if (parsed.ok) return ok(parsed.plan);
  return err(
    parsed.error === 'NO_FILTERS'
      ? { code: 'NO_FILTERS', unresolved: parsed.unresolved }
      : { code: 'UNREADABLE' }
  );
}
