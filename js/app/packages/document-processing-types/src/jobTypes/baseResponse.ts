import { z } from 'zod';

export const BaseResponse = z.object({
  jobId: z.string(),
  jobType: z.string(),
  error: z.boolean().optional(),
  message: z.string().optional(),
});
