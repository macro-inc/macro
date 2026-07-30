import type { MacroClient } from '../../utils/client';
import type { Project } from '../projects/project';
import type { SearchOpts } from '../search';
import { Document } from './document';

export class DocumentNamespace {
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
