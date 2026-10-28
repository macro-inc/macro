import type {
  Anchor as AnchorRecord,
  EditPdfPlaceableCommentAnchorRequest,
} from '../../../generated/storage/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import type { Document } from './document';

/** A PDF annotation scoped to its document. */
export class DocumentAnchor extends MacroEntity<AnchorRecord> {
  /** Serialize identity with its owning resource. */
  override toJSON() {
    return { ...super.toJSON(), documentId: this.document.id };
  }

  private constructor(
    client: MacroClient,
    /** Owning document. */
    readonly document: Document,
    id: string,
    seed?: AnchorRecord,
  ) {
    super(client, id, seed);
  }

  /** Construct a document scoped annotation handle. */
  static byId(
    client: MacroClient,
    document: Document,
    id: string,
  ): DocumentAnchor {
    return new DocumentAnchor(client, document, id);
  }

  /** Seed an annotation from a document annotation listing. */
  static from(
    client: MacroClient,
    document: Document,
    record: AnchorRecord,
  ): DocumentAnchor {
    return new DocumentAnchor(client, document, record.uuid, record);
  }

  protected async fetch(): Promise<AnchorRecord> {
    const record = unwrap(
      await this.client.storage.getDocumentAnchors({
        path: { document_id: this.document.id },
      }),
    ).data.find((a) => a.uuid === this.id);
    if (!record)
      throw new MacroNotFoundError(`Annotation ${this.id} is unavailable`);
    return record;
  }

  /** Annotation kind. */
  readonly kind = this.field('anchorType');

  /** Page containing the annotation. */
  readonly page = this.field('page');

  /** Edit a placeable comment's position and display settings. */
  async edit(
    options: Omit<EditPdfPlaceableCommentAnchorRequest, 'uuid'>,
  ): Promise<void> {
    if ((await this.kind()) !== 'placeable')
      throw new Error('Only placeable comment annotations can be edited');
    await this.mutate((c) =>
      c.storage.editAnchor({
        body: {
          ...options,
          uuid: this.id,
          anchorType: 'free-comment',
          fileType: 'pdf',
        },
      }),
    );
  }

  /** Delete a standalone highlight annotation. */
  async delete(): Promise<void> {
    if ((await this.kind()) !== 'highlight')
      throw new Error(
        'Only standalone highlights can be deleted with this endpoint',
      );
    await this.mutate((c) =>
      c.storage.deleteAnchor({
        body: { uuid: this.id, anchorType: 'highlight', fileType: 'pdf' },
      }),
    );
  }
}
