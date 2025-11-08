import type { JobTypes } from '@macro-inc/document-processing-job-types';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from '../../utils/logger';

export async function checkForCachedResult(
  macroDB: PrismaClient,
  logger: Logger,
  args: { jobId: string; documentId: string; jobType: JobTypes }
): Promise<boolean> {
  const { jobId, documentId, jobType } = args;
  const metadata = {
    job_id: jobId,
    document_id: documentId,
    job_type: jobType,
  };

  try {
    const result = await macroDB.documentProcessResult.findFirst({
      where: {
        documentId,
        jobType,
      },
      select: {
        id: true,
      },
    });

    if (!result) {
      return false;
    }

    // If we have a cached result, add the result to the jobToDocumentResult table
    // so it can be grabbed using DSS for the user
    await macroDB.jobToDocumentProcessResult.create({
      data: { jobId, documentProcessResultId: result.id },
    });
  } catch (err) {
    logger.error('unable to check for cached result', {
      ...metadata,
      error: err,
    });
    // unable to get cached result at this time
    return false;
  }
  return true;
}
