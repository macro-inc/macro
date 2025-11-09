import { z } from 'zod';

export interface IBookmark {
  title: string | null;
  pageNum: number;
  top: number;
  children: IBookmark[];
  id: number;
}

export const IBookmarkSchema: z.ZodType<IBookmark> = z.object({
  title: z.string().nullable(),
  pageNum: z.number(),
  top: z.number(),
  children: z.array(z.lazy(() => IBookmarkSchema as z.ZodType<IBookmark>)),
  id: z.number(),
});
