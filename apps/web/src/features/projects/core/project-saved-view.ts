import { err, ok } from 'neverthrow';
import { z } from 'zod';
import {
  DEFAULT_PROJECT_SETTINGS,
  type ProjectCollectionSettings,
  type ProjectScope,
} from './project';

const calendarDate = z.union([z.literal(''), z.iso.date()]);
const settingsSchema = z.object({
  layout: z.enum(['list', 'gantt']),
  status: z.string().max(200),
  priority: z.string().max(200),
  dueBefore: calendarDate,
  dueAfter: calendarDate,
  mine: z.boolean(),
  sort: z.enum(['updated', 'created']),
  groupBy: z.enum(['none', 'status', 'priority', 'assignee']),
});
const scopeSchema = z.enum(['all', 'assigned-to-me', 'created-by-me']);
const definitionSchema = z
  .object({
    kind: z.literal('projects'),
    version: z.literal(1),
    scope: scopeSchema,
    settings: settingsSchema,
  })
  .strict();
export type ProjectSavedViewConfig = z.infer<typeof definitionSchema>;
export type ProjectSavedViewIssue = { message: string };

export function captureProjectSavedView(
  settings: ProjectCollectionSettings,
  scope: ProjectScope
) {
  return decodeProjectSavedView({
    kind: 'projects',
    version: 1,
    settings,
    scope,
  });
}

export function decodeProjectSavedView(value: unknown) {
  const parsed = definitionSchema.safeParse(value);
  if (!parsed.success)
    return err('This project view contains unsupported settings.');
  const { dueAfter, dueBefore } = parsed.data.settings;
  if (dueAfter && dueBefore && dueAfter > dueBefore)
    return err('The start date must not follow the end date.');
  return ok(parsed.data);
}

/** Unknown definitions never silently broaden a project collection. */
export function readProjectSavedView(value: unknown): {
  config: ProjectSavedViewConfig;
  issues: ProjectSavedViewIssue[];
} {
  const decoded = decodeProjectSavedView(value);
  if (decoded.isOk()) return { config: decoded.value, issues: [] };
  return {
    config: {
      kind: 'projects',
      version: 1,
      scope: 'all',
      settings: { ...DEFAULT_PROJECT_SETTINGS },
    },
    issues: [{ message: decoded.error }],
  };
}

export function projectSavedViewsEqual(
  left: ProjectSavedViewConfig,
  right: ProjectSavedViewConfig
) {
  return JSON.stringify(left) === JSON.stringify(right);
}
