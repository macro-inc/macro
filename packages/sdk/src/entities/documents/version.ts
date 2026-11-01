import type { GetDocumentResponseData } from '../../../generated/storage/types.gen';
import { Lazy, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { Document } from './document';

/** An immutable document version, scoped to its document. */
export class DocumentVersion {
  private readonly detail: Lazy<GetDocumentResponseData>;

  private constructor(
    private readonly client: MacroClient,
    /** Parent document. */
    readonly document: Document,
    /** Version number. */
    readonly id: number,
  ) {
    this.detail = new Lazy(
      async () =>
        unwrap(
          await this.client.storage.getDocumentVersion({
            path: { document_id: document.id, document_version_id: id },
          }),
        ).data,
    );
  }

  /** Construct a version handle. */
  static byId(
    client: MacroClient,
    document: Document,
    id: number,
  ): DocumentVersion {
    return new DocumentVersion(client, document, id);
  }

  /** Version metadata and the caller's access. */
  read(): Promise<GetDocumentResponseData> {
    return this.detail.get();
  }

  /** Serialize only scoped identity. */
  toJSON() {
    return { id: this.id, documentId: this.document.id };
  }
}
