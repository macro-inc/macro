import { z } from 'zod';

const displayModeSchema = z.enum(['show', 'hide_when_empty', 'hide']);
const simpleDisplayModeSchema = z.enum(['show', 'hide']);

export const taskPropertyDisplaySchema = z
  .object({
    priority: displayModeSchema.default('show'),
    tags: simpleDisplayModeSchema.default('show'),
    dueDate: displayModeSchema.default('show'),
    project: displayModeSchema.default('show'),
    assignees: displayModeSchema.default('show'),
    updated: simpleDisplayModeSchema.default('show'),
    createdBy: simpleDisplayModeSchema.default('show'),
  })
  .strict();

export type TaskPropertyDisplay = z.infer<typeof taskPropertyDisplaySchema>;
export type TaskPropertyId = keyof TaskPropertyDisplay;
export type TaskPropertyDisplayMode = z.infer<typeof displayModeSchema>;

export const DEFAULT_TASK_PROPERTY_DISPLAY = taskPropertyDisplaySchema.parse(
  {}
);

/** Retains valid modes while replacing missing or invalid modes with defaults. */
export function readTaskPropertyDisplay(value: unknown): TaskPropertyDisplay {
  const parsed = z.record(z.string(), z.unknown()).safeParse(value);
  const fields = parsed.success ? parsed.data : {};
  const readMode = <T extends TaskPropertyDisplayMode>(
    value: unknown,
    schema: z.ZodType<T>,
    fallback: T
  ): T => {
    const mode = schema.safeParse(value);
    return mode.success ? mode.data : fallback;
  };

  return {
    priority: readMode(
      fields.priority,
      taskPropertyDisplaySchema.shape.priority,
      'show'
    ),
    tags: readMode(fields.tags, taskPropertyDisplaySchema.shape.tags, 'show'),
    dueDate: readMode(
      fields.dueDate,
      taskPropertyDisplaySchema.shape.dueDate,
      'show'
    ),
    project: readMode(
      fields.project,
      taskPropertyDisplaySchema.shape.project,
      'show'
    ),
    assignees: readMode(
      fields.assignees,
      taskPropertyDisplaySchema.shape.assignees,
      'show'
    ),
    updated: readMode(
      fields.updated,
      taskPropertyDisplaySchema.shape.updated,
      'show'
    ),
    createdBy: readMode(
      fields.createdBy,
      taskPropertyDisplaySchema.shape.createdBy,
      'show'
    ),
  };
}

/** Hidden empty cells retain their column track so other rows stay aligned. */
export function showTaskProperty(
  mode: TaskPropertyDisplayMode,
  hasValue: boolean
): boolean {
  return mode === 'show' || (mode === 'hide_when_empty' && hasValue);
}
