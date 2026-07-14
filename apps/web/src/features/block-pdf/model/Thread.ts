import { z } from 'zod';

// TODO: deprecate this fully
export class Thread {
  public headID: string;
  public page: number;
  public comments: any[];
  public isResolved: boolean;

  constructor(
    headID: string,
    page: number,
    comments?: any[],
    isResolved?: boolean
  ) {
    this.headID = headID;
    this.page = page;
    this.comments = comments ?? [];
    this.isResolved = isResolved ?? false;
  }

  public static toObject(this_: Thread): IThread {
    return {
      headID: this_.headID,
      page: this_.page,
      comments: this_.comments,
      isResolved: this_.isResolved,
    };
  }
}

export const ThreadSchema = z.object({
  headID: z.string(),
  page: z.number(),
  comments: z.array(z.any()),
  isResolved: z.boolean(),
});

export type IThread = z.infer<typeof ThreadSchema>;
