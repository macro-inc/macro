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

const driveDatabaseTargetSchema = z.object({
  type: z.enum(['database', 'form']),
  id: z.string().min(1),
  fallbackName: z.string().optional(),
});

const driveDetailTargetSchema = z.union([
  driveDocumentTargetSchema,
  driveDatabaseTargetSchema,
]);

export const driveDetailTrailSchema = z.array(driveDetailTargetSchema).min(1);

export type DriveDetailTarget = z.infer<typeof driveDetailTargetSchema>;

export function detailTargetFromRoute(
  document: DriveDocumentRoute | undefined
): DriveDetailTarget | undefined {
  if (!document) return;

  const target = {
    type: 'document' as const,
    id: document.id,
  };

  switch (document.type) {
    case 'database':
    case 'form':
      return { type: document.type, id: document.id };
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

export function detailRouteFromTarget(
  target: DriveDetailTarget
): DriveDocumentRoute {
  if (target.type !== 'document') return { id: target.id, type: target.type };

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
