import { z } from 'zod';
import type { DriveDocumentRoute } from './drive-route';
import { driveDocumentRoute } from './drive-route';

export const driveDocumentTargetSchema = z.object({
  type: z.literal('document'),
  id: z.string().min(1),
  fileType: z.string().optional(),
  subType: z
    .object({
      type: z.enum(['task', 'snippet', 'skill']),
      is_completed: z.boolean().optional(),
    })
    .nullable()
    .optional(),
  fallbackName: z.string().optional(),
});

export const driveDetailTrailSchema = z.array(driveDocumentTargetSchema).min(1);

export type DriveDocumentTarget = z.infer<typeof driveDocumentTargetSchema>;

export function documentTargetFromRoute(
  document: DriveDocumentRoute | undefined
): DriveDocumentTarget | undefined {
  if (!document) return;

  const target = {
    type: 'document' as const,
    id: document.id,
  };

  switch (document.type) {
    case 'task':
      return {
        ...target,
        fileType: 'md',
        subType: { type: 'task', is_completed: false },
      };
    case 'snippet':
    case 'skill':
      return {
        ...target,
        fileType: 'md',
        subType: { type: document.type },
      };
    default:
      return { ...target, fileType: document.type };
  }
}

export function documentRouteFromTarget(
  target: DriveDocumentTarget
): DriveDocumentRoute {
  return driveDocumentRoute({
    id: target.id,
    fileType: target.fileType ?? 'unknown',
    subType: target.subType?.type,
  });
}

export function sameDocumentRoute(
  left: DriveDocumentRoute | undefined,
  right: DriveDocumentRoute | undefined
): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.id === right.id &&
    left.type === right.type
  );
}
