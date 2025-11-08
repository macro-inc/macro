import { v4 as uuid } from 'uuid';
import { TEMP_FILE_PREFIX } from '../../config';
import type { S3 } from '../../service/s3Service';

export async function uploadPdf(
  s3Client: S3,
  docStorageBucket: string,
  jobId: string,
  uploadData: ArrayBuffer
) {
  const key = `${TEMP_FILE_PREFIX}${jobId}-${uuid()}.pdf`;
  await s3Client.putObject(docStorageBucket, key, uploadData);
  return await s3Client.getPresignedUrl(docStorageBucket, key);
}

export async function uploadDocx(
  s3Client: S3,
  docStorageBucket: string,
  jobId: string,
  uploadData: ArrayBuffer
) {
  const key = `${TEMP_FILE_PREFIX}${jobId}-${uuid()}.docx`;
  await s3Client.putObject(docStorageBucket, key, uploadData);
  return await s3Client.getPresignedUrl(docStorageBucket, key);
}
