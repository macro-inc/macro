import { z } from 'zod';

// The base response for all jobs
// All response objects will extend this and any custom data in a response object
// will be located in it's `data` property
export const BaseResponse = z.object({
  // The id of the job
  jobId: z.string(),
  // The type of the job (JobTypes)
  jobType: z.string(),
  // If there was an error
  error: z.boolean().optional(),
  // The error message if error is true
  message: z.string().optional(),
});
