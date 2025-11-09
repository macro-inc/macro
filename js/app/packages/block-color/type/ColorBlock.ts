export type Swatch = {
  color: string;
};

export type ColumnConstraints = {
  lockL?: boolean;
  lockC?: boolean;
  lockH?: boolean;
};

export type ColorColumn = {
  colors: Swatch[];
  constraints?: ColumnConstraints;
};

export type ColorBlock = {
  name: string;
  columns: ColorColumn[];
};

export type ColorDocument = {
  id: string;
  data: ColorBlock;
  createdAt: number;
  updatedAt: number;
  fileType: string;
  owner?: string;
  projectId?: string;
};

// Runtime validation
import { z } from 'zod';

export const SwatchSchema = z.object({
  color: z.string().min(1),
});

export const ColumnConstraintsSchema = z
  .object({
    lockL: z.boolean().optional(),
    lockC: z.boolean().optional(),
    lockH: z.boolean().optional(),
  })
  .partial()
  .optional();

export const ColorColumnSchema = z.object({
  colors: z.array(SwatchSchema),
  constraints: ColumnConstraintsSchema,
});

export const ColorBlockSchema = z.object({
  name: z.string().min(1),
  columns: z.array(ColorColumnSchema),
});

export function parseColorBlock(value: unknown): ColorBlock | undefined {
  const res = ColorBlockSchema.safeParse(value);
  if (!res.success) return undefined;
  return res.data;
}

export const ColorDocumentSchema = z.object({
  id: z.string().min(1),
  data: ColorBlockSchema,
  createdAt: z.number().finite().nonnegative(),
  updatedAt: z.number().finite().nonnegative(),
  fileType: z.string().min(1),
  owner: z.string().optional(),
  projectId: z.string().optional(),
});

export function parseColorDocument(value: unknown): ColorDocument | undefined {
  const res = ColorDocumentSchema.safeParse(value);
  if (!res.success) return undefined;
  return res.data;
}
