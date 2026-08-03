import type { PropertyTargetEntityType as PropertyEntityType } from '../../../generated/properties/types.gen';
import type {
  Thread as CommentThreadRecord,
  DocumentTeamShareResponse,
  GetDocumentResponses,
  GetUserDocumentsHandlerData,
  GithubPullRequest,
} from '../../../generated/storage/types.gen';
import { type Mentionable, type MentionPart, wrapXml } from '../../mentions';
import { MacroApiError, MacroError, paginate, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { PropertiedEntity } from '../entity';
import { Project } from '../projects/project';
import { entitySearch } from '../search';
import { User } from '../users/user';
import { Comment } from './comment';

type DocumentDetail = GetDocumentResponses[200]['data']['documentMetadata'];

/** One of a document's comment threads: the thread record and its comments. */
export interface CommentThread {
  /** The thread record: id, resolved state, owner, timestamps. */
  thread: CommentThreadRecord;
  /** The thread's comments, in order. */
  comments: Comment[];
}

/**
 * A Macro document. Can be dropped into a {@link msg} template to render an
 * inline link to the document.
 */
export class Document
  extends PropertiedEntity<DocumentDetail>
  implements Mentionable
{
  protected async fetch(): Promise<DocumentDetail> {
    const { data } = unwrap(
      await this.client.storage.getDocument({
        path: { document_id: this.id },
      }),
    );
    return data.documentMetadata;
  }

  /** A handle to a document by id. Details load on first access. */
  static byId(client: MacroClient, id: string): Document {
    return new Document(client, id);
  }

  /** Create a markdown document. */
  static async create(
    client: MacroClient,
    opts: { name: string; markdown?: string; project?: Project },
  ): Promise<Document> {
    const { documentId } = unwrap(
      await client.storage.createMarkdownHandler({
        body: {
          documentName: opts.name,
          markdown: opts.markdown ?? null,
          projectId: opts.project?.id ?? null,
        },
      }),
    );
    return new Document(client, documentId);
  }

  /**
   * Create a snippet: a reusable markdown document that can be inserted into
   * any markdown area.
   */
  static async createSnippet(
    client: MacroClient,
    opts: { name: string; markdown?: string; project?: Project },
  ): Promise<Document> {
    const { documentId } = unwrap(
      await client.storage.createSnippetHandler({
        body: {
          snippetName: opts.name,
          markdown: opts.markdown ?? null,
          projectId: opts.project?.id ?? null,
        },
      }),
    );
    return new Document(client, documentId);
  }

  /** The user's recent documents, most recent first, auto-paginated. */
  static recent(
    client: MacroClient,
    opts?: { pageSize?: number; fileType?: string },
  ): AsyncGenerator<Document> {
    const limit = opts?.pageSize ?? 50;
    return paginate(async (cursor) => {
      const page = unwrap(
        await client.storage.getUserDocumentsHandler({
          query: {
            limit,
            offset: cursor ? Number(cursor) : 0,
            ...(opts?.fileType !== undefined
              ? { file_type: opts.fileType }
              : {}),
          } as GetUserDocumentsHandlerData['query'],
        }),
      );
      const next = page.data?.next_offset;
      return {
        items: (page.data?.documents ?? []).map(
          (d) => new Document(client, d.documentId),
        ),
        nextCursor: next != null ? String(next) : null,
      };
    });
  }

  /**
   * The user's recently soft-deleted documents. The underlying endpoint also
   * returns deleted chats and projects; those are filtered out here.
   */
  static async recentlyDeleted(client: MacroClient): Promise<Document[]> {
    const { data } = unwrap(await client.storage.recentlyDeleted({}));
    return data.items
      .filter((i) => i.type === 'document')
      .map((d) => new Document(client, d.id));
  }

  /** Favorites identify documents as `document`. */
  readonly entityType = 'document';

  /** The properties service identifies documents as `DOCUMENT`. */
  protected readonly propertyEntityType: PropertyEntityType = 'DOCUMENT';

  /** The document's display name. */
  readonly name = this.field('documentName');

  /** The document's file type (e.g. `md`, `pdf`, `docx`). */
  readonly fileType = this.field('fileType');

  /** The project this document belongs to, if any. */
  readonly project = this.mappedField('projectId', (id) =>
    id ? Project.byId(this.client, id) : undefined,
  );

  /** The user who owns the document. */
  readonly owner = this.mappedField('owner', (id) =>
    User.byId(this.client, id),
  );

  /** The document this one was branched from, if any. */
  readonly branchedFrom = this.mappedField('branchedFromId', (id) =>
    id ? Document.byId(this.client, id) : undefined,
  );

  /** When the document was created. */
  readonly createdAt = this.field('createdAt');

  /** When the document was last updated. */
  readonly updatedAt = this.field('updatedAt');

  /** When the document was deleted, if it has been. */
  readonly deletedAt = this.field('deletedAt');

  /**
   * The document's raw content (markdown source for markdown documents),
   * downloaded via a presigned export URL.
   */
  async content(): Promise<string> {
    const { presigned_url } = unwrap(
      await this.client.storage.exportDocument({
        path: { document_id: this.id },
      }),
    );
    const res = await fetch(presigned_url);
    if (!res.ok)
      throw new MacroApiError(res.status, {
        message: 'failed to download document content',
      });
    return res.text();
  }

  /** Rename the document. */
  async rename(name: string): Promise<void> {
    await this.mutate((c) =>
      c.storage.editDocument({
        path: { document_id: this.id },
        body: { documentName: name },
      }),
    );
  }

  /** Move the document into a project (or out of one, with `null`). */
  async move(project: Project | null): Promise<void> {
    await this.mutate((c) =>
      c.storage.editDocument({
        path: { document_id: this.id },
        body: { projectId: project?.id ?? '' },
      }),
    );
  }

  /**
   * Delete the document. Soft by default (reversible with {@link restore});
   * pass `permanent: true` to delete irreversibly.
   */
  async delete(opts?: { permanent?: boolean }): Promise<void> {
    await this.mutate<unknown>((c) =>
      opts?.permanent
        ? c.storage.permanentlyDeleteDocument({
            path: { document_id: this.id },
          })
        : c.storage.deleteDocument({ path: { document_id: this.id } }),
    );
  }

  /** Restore a soft-deleted document. */
  async restore(): Promise<void> {
    await this.mutate((c) =>
      c.storage.revertDeleteDocument({ path: { document_id: this.id } }),
    );
  }

  /**
   * Copy the document under a new name, optionally from a specific version.
   * Returns a handle to the new document.
   */
  async copy(opts: { name: string; versionId?: number }): Promise<Document> {
    const { data } = unwrap(
      await this.client.storage.copyDocument({
        path: { document_id: this.id },
        query:
          opts.versionId !== undefined
            ? { version_id: opts.versionId }
            : undefined,
        body: { documentName: opts.name },
      }),
    );
    return new Document(this.client, data.documentMetadata.documentId);
  }

  /** The document's comment threads, each with its comments. */
  async comments(): Promise<CommentThread[]> {
    const { data } = unwrap(
      await this.client.storage.getDocumentComments({
        path: { document_id: this.id },
      }),
    );
    return data.map(({ thread, comments }) => ({
      thread,
      comments: comments.map((c) => Comment.from(this.client, this, c)),
    }));
  }

  /**
   * Add a comment. Starts a new unanchored thread, or replies to an existing
   * one when `threadId` is given. Returns the created comment.
   */
  async comment(text: string, opts?: { threadId?: number }): Promise<Comment> {
    const { comments } = await this.mutate((c) =>
      c.storage.createComment({
        path: { document_id: this.id },
        body: { text, threadId: opts?.threadId ?? null },
      }),
    );
    // The response is the whole thread; the new comment has the highest id.
    const created = comments.reduce<(typeof comments)[number] | undefined>(
      (a, b) => (!a || b.commentId > a.commentId ? b : a),
      undefined,
    );
    if (!created)
      throw new MacroError('create comment returned an empty thread');
    return Comment.from(this.client, this, created);
  }

  /** The document's short id (used in compact links and branch names). */
  async shortId(): Promise<string> {
    return unwrap(
      await this.client.storage.getDocumentShortId({
        path: { document_id: this.id },
      }),
    );
  }

  /** Whether the document is shared with the owner's team, and which team. */
  async teamShare(): Promise<DocumentTeamShareResponse> {
    return unwrap(
      await this.client.storage.getDocumentTeamShare({
        path: { document_id: this.id },
      }),
    );
  }

  /** Share the document with the owner's team, or unshare it. */
  async setTeamShare(shared: boolean): Promise<void> {
    await this.mutate((c) =>
      c.storage.setDocumentTeamShare({
        path: { document_id: this.id },
        body: { shareWithTeam: shared },
      }),
    );
  }

  /** GitHub pull requests associated with the document. */
  async githubPullRequests(): Promise<GithubPullRequest[]> {
    const { pullRequests } = unwrap(
      await this.client.storage.getDocumentGithubPullRequests({
        path: { document_id: this.id },
      }),
    );
    return pullRequests;
  }

  /** The git branch name derived for the document (task documents). */
  async branchName(): Promise<string> {
    const { branchName } = unwrap(
      await this.client.storage.getDocumentBranchName({
        path: { document_id: this.id },
      }),
    );
    return branchName;
  }

  /** The document's URL in the Macro web app. */
  webUrl(): string {
    return `${this.client.webAppUrl}/app/md/${this.id}`;
  }

  /** Search documents by name and content, most relevant first, auto-paginated. */
  static search = entitySearch({
    filters: { document_filters: {} },
    type: 'document',
    make: (client, hit) => new Document(client, hit.document_id),
  });

  toMention(): MentionPart {
    const loaded = this.detail.peek();
    return {
      tag: wrapXml('m-document-mention', {
        documentId: this.id,
        documentName: loaded?.documentName ?? '',
        blockName: loaded?.fileType ?? 'md',
      }),
      mention: { entity_type: 'document', entity_id: this.id },
    };
  }
}
