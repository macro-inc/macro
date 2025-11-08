import type { File } from '../types/file';
import type { Logger } from '../utils/logger';

function makeFormData(file: File) {
  const data = new FormData();
  data.append('file', file.blob, file.name);
  return data;
}

class PdfService {
  logger: Logger;
  baseUrl: string;
  constructor(baseUrl: string, logger: Logger) {
    this.baseUrl = baseUrl;
    this.logger = logger;
    this.logger.debug('initiated PdfService', { baseUrl });
  }

  async ping() {
    this.logger.debug('ping');
    return fetch(`${this.baseUrl}/ping`);
  }

  async preprocess(file: File, includeDocumentData?: boolean) {
    const body = makeFormData(file);
    body.append('includeDocumentData', includeDocumentData ? 'true' : 'false');
    return fetch(`${this.baseUrl}/preprocess`, {
      body,
      method: 'POST',
    });
  }

  async ocr_perform(file: File) {
    const body = makeFormData(file);
    return fetch(`${this.baseUrl}/ocr/perform`, {
      body,
      method: 'POST',
    });
  }

  async modify(
    file: File,
    modificationData: { [name: string]: any },
    shouldSaveBookmarks: boolean
  ) {
    const body = makeFormData(file);
    const { highlights, bookmarks, placeables, pinnedTermsNames } =
      modificationData;
    if (highlights) {
      body.append('highlights', JSON.stringify(highlights));
    }
    if (bookmarks && shouldSaveBookmarks) {
      body.append('bookmarks', JSON.stringify(bookmarks));
    }
    if (placeables) {
      body.append(
        'placeables',
        JSON.stringify(
          placeables.map((placeable: any) => {
            const replacedSet: Object = { ...placeable };
            (replacedSet as any)['pageRange'] = Array.from(placeable.pageRange);
            return replacedSet;
          })
        )
      );
    }
    if (pinnedTermsNames) {
      body.append('pinnedTermsNames', JSON.stringify(pinnedTermsNames));
    }

    return fetch(`${this.baseUrl}/modify`, {
      method: 'POST',
      body,
    });
  }

  async convert(file: File, toExtension: string) {
    const body = makeFormData(file);
    body.append('outputExtension', toExtension);
    body.append('inputExtension', file.type.includes('pdf') ? 'pdf' : 'docx');

    return fetch(`${this.baseUrl}/convert`, {
      method: 'POST',
      body,
    });
  }

  async password_detect(file: File) {
    const body = makeFormData(file);
    return fetch(`${this.baseUrl}/password/detect`, {
      body,
      method: 'POST',
    });
  }

  async password_decrypt(file: File, password: string) {
    const body = makeFormData(file);
    body.append('password', password);
    return fetch(`${this.baseUrl}/password/decrypt`, {
      body,
      method: 'POST',
    });
  }

  async password_encrypt(file: File, password: string) {
    const body = makeFormData(file);
    body.append('password', password);
    return fetch(`${this.baseUrl}/password/encrypt`, {
      body,
      method: 'POST',
    });
  }

  async remove_metadata(file: File) {
    const body = makeFormData(file);
    return fetch(`${this.baseUrl}/removeMetadata`, {
      body,
      method: 'POST',
    });
  }
}

let _pdfService: PdfService;

export function pdfService(baseUrl?: string, logger?: Logger): PdfService {
  if (!_pdfService) {
    if (!logger) {
      throw new Error('Logger is required to instantiate PdfService');
    }
    if (!baseUrl) {
      throw new Error('baseUrl is required to instantiate PdfService');
    }
    _pdfService = new PdfService(baseUrl, logger);
  }
  return _pdfService;
}
