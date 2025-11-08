import type { JobTypes } from '@macro-inc/document-processing-job-types';

export class PdfServiceError extends Error {
  constructor(jobType: JobTypes) {
    super(`pdf service error non-200 for ${jobType}`);
  }
}

export class DocxServiceError extends Error {
  constructor(jobType: JobTypes) {
    super(`docx service error non-200 for ${jobType}`);
  }
}
