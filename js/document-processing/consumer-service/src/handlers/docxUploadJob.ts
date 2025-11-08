import type { PrismaClient } from '@prisma/client';

/**
 * @description Inserts a docx upload job entry into the database
 * @throws Error if the job entry cannot be inserted
 */
export async function insertDocxUploadJobEntry(
  db: PrismaClient,
  {
    jobId,
    documentId,
    jobType,
  }: {
    jobId: string;
    documentId: string;
    jobType: string;
  }
) {
  await db.uploadJob.create({
    data: {
      jobId,
      documentId,
      jobType,
    },
  });
}
