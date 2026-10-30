import type { CreateDocumentRequest } from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { EmailAttachment } from '../email/attachment';
import type { Project } from '../projects/project';
import type { SearchOpts } from '../search';
import type { Team } from '../teams/team';
import { User } from '../users/user';
import { Document } from './document';
import { SystemSkill } from './system-skill';

export class DocumentNamespace {
  /** Resolve a team task reference such as ENG-42. */
  async byTeamSlug(slug: string): Promise<Document> {
    // The generated operation currently references a colliding TypedSuccessResponse
    // schema. Validate the actual document response before constructing a handle.
    const result: unknown = unwrap(
      await this.client.storage.getDocumentByTeamSlug({ path: { slug } }),
    );
    if (
      typeof result !== 'object' ||
      result === null ||
      !('data' in result) ||
      typeof result.data !== 'object' ||
      result.data === null ||
      !('documentMetadata' in result.data) ||
      typeof result.data.documentMetadata !== 'object' ||
      result.data.documentMetadata === null ||
      !('documentId' in result.data.documentMetadata) ||
      typeof result.data.documentMetadata.documentId !== 'string'
    )
      throw new Error('Invalid team task document response');
    return Document.byId(this.client, result.data.documentMetadata.documentId);
  }

  /** Validate a permissions token, returning its document and optional user handles. */
  async validatePermissionsToken(token: string) {
    const result = unwrap(
      await this.client.storage.validateDocumentPermissionsToken({
        body: { token },
      }),
    );
    return {
      document: Document.byId(this.client, result.document_id),
      user: result.user_id ? User.byId(this.client, result.user_id) : undefined,
      accessLevel: result.access_level,
      expiresAt: result.exp,
      issuer: result.iss,
    };
  }

  /** Reserve a binary document and return upload instructions. Upload content before saving. */
  async createUpload(options: {
    name: string;
    sha: string;
    fileType?: string;
    mimeType?: string;
    project?: Project;
    team?: Team;
    branchedFrom?: Document;
    attachment?: EmailAttachment;
    isTask?: boolean;
  }) {
    const body: CreateDocumentRequest = {
      documentName: options.name,
      sha: options.sha,
      fileType: options.fileType,
      mimeType: options.mimeType,
      projectId: options.project?.id,
      teamId: options.team?.id,
      branchedFromId: options.branchedFrom?.id,
      emailAttachmentId: options.attachment?.id,
      isTask: options.isTask,
    };
    const result = unwrap(
      await this.client.storage.createDocument({ body }),
    ).data;
    return {
      document: Document.byId(this.client, result.documentMetadata.documentId),
      uploadUrl: result.presignedUrl ?? undefined,
      contentType: result.contentType,
      content: result.documentMetadata.content,
    };
  }

  constructor(private readonly client: MacroClient) {}

  /** A handle to a document by id. Details load on first access. */
  byId(id: string): Document {
    return Document.byId(this.client, id);
  }

  /** Create a markdown document. */
  create(opts: {
    name: string;
    markdown?: string;
    project?: Project;
  }): Promise<Document> {
    return Document.create(this.client, opts);
  }

  /** Create a native Canvas with shared content ready for reading and editing. */
  async createCanvas(opts: {
    name: string;
    project?: Project;
  }): Promise<Document> {
    const result = unwrap(
      await this.client.storage.createCanvasHandler({
        body: { documentName: opts.name, projectId: opts.project?.id },
      }),
    );
    return Document.byId(this.client, result.documentId);
  }

  /** Create a snippet: a reusable markdown document. */
  createSnippet(opts: {
    name: string;
    markdown?: string;
    project?: Project;
  }): Promise<Document> {
    return Document.createSnippet(this.client, opts);
  }

  /** Create a skill: markdown instructions that AI reads and follows. */
  createSkill(opts: {
    name: string;
    markdown?: string;
    project?: Project;
  }): Promise<Document> {
    return Document.createSkill(this.client, opts);
  }

  /**
   * The built-in system skills: static AI instructions with no document
   * behind them. Unlike user skills they cannot be opened or edited.
   */
  systemSkills(): Promise<SystemSkill[]> {
    return SystemSkill.list(this.client);
  }

  /** Search documents by name and content, most relevant first, auto-paginated. */
  search(query: string, opts?: SearchOpts): AsyncGenerator<Document> {
    return Document.search(this.client, query, opts);
  }

  /** The user's recent documents, most recent first, auto-paginated. */
  recent(opts?: {
    pageSize?: number;
    fileType?: string;
  }): AsyncGenerator<Document> {
    return Document.recent(this.client, opts);
  }

  /** The user's recently soft-deleted documents. */
  recentlyDeleted(): Promise<Document[]> {
    return Document.recentlyDeleted(this.client);
  }
}
