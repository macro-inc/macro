import type { File } from '../types/file';
import type { Logger } from '../utils/logger';

class DocxService {
  logger: Logger;
  baseUrl: string;
  constructor(baseUrl: string, logger: Logger) {
    this.baseUrl = baseUrl;
    this.logger = logger;
    this.logger.debug('initiated DocxService', { baseUrl });
  }

  async ping() {
    this.logger.debug('ping');
    return fetch(`${this.baseUrl}/ping-docx`);
  }

  async simple_compare({
    v1,
    v2,
    revisedUpload,
    keepComments,
    isPdfCompare,
  }: {
    v1: File;
    v2: File;
    revisedUpload: { color?: string; author?: string };
    keepComments: boolean;
    isPdfCompare: boolean;
  }) {
    this.logger.debug('simple compare');
    const formData = new FormData();
    formData.append('v1', v1.blob);
    formData.append('v2', v2.blob);
    formData.append('uploadData', JSON.stringify(revisedUpload));
    formData.append('keepComments', String(keepComments));
    formData.append('isPdfCompare', String(isPdfCompare));

    return fetch(`${this.baseUrl}/compare/simple-compare`, {
      method: 'POST',
      body: formData,
    });
  }

  async consolidate({
    sourceUpload,
    revisedUploads,
    isPdfCompare,
  }: {
    sourceUpload: { file: File; color?: string; author?: string };
    revisedUploads: { file: File; color?: string; author?: string }[];
    isPdfCompare: boolean;
  }) {
    this.logger.debug('consolidate');
    const formData = new FormData();
    formData.append(
      'originalFile',
      sourceUpload.file.blob,
      sourceUpload.file.name
    );
    for (const upload of revisedUploads) {
      formData.append('revisedFiles', upload.file.blob, upload.file.name); // important to note the key for the form-data is plural `revisedFiles`
    }
    formData.append(
      'uploadDataJson',
      JSON.stringify({ source: sourceUpload, revised: revisedUploads })
    );
    formData.append('isPdfCompare', String(isPdfCompare));

    return fetch(`${this.baseUrl}/compare/consolidate`, {
      method: 'POST',
      body: formData,
    });
  }

  async count_revisions(documentData: Buffer, fileName: string) {
    this.logger.debug('count_revisions');
    const formData = new FormData();
    formData.append('file', new Blob([documentData]), fileName);
    return fetch(`${this.baseUrl}/compare/count-revisions`, {
      method: 'POST',
      body: formData,
    });
  }
}

let _docxService: DocxService;

export function docxService(baseUrl?: string, logger?: Logger): DocxService {
  if (!_docxService) {
    if (!logger) {
      throw new Error('Logger is required to instantiate DocxService');
    }
    if (!baseUrl) {
      throw new Error('baseUrl is required to instantiate DocxService');
    }
    _docxService = new DocxService(baseUrl, logger);
  }
  return _docxService;
}
