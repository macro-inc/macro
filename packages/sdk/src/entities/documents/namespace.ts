import type { CreateDocumentRequest } from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { EmailAttachment } from '../email/attachment';
import type { Project } from '../projects/project';
import type { SearchOpts } from '../search/options';
import { Spreadsheet } from '../spreadsheets/spreadsheet';
import type { Team } from '../teams/team';
import { User } from '../users/user';
import { Document } from './document';
import { SystemSkill } from './system-skill';

/** One skill found by {@link DocumentNamespace.skills}. */
export interface SkillListing {
  /**
   * The skill: a skill document, or a built-in skill with no document. Read
   * either one's instructions with `content()`.
   */
  skill: Document | SystemSkill;
  /** The skill's name. */
  name: string;
  /** When to use the skill, when it says. Built-in skills have none. */
  description: string | undefined;
  /** When the skill document was last updated (ISO 8601); built-in skills have none. */
  updatedAt: string | undefined;
}

/** A file's content: its bytes, or text stored as UTF-8. */
export type FileContent = Uint8Array<ArrayBuffer> | ArrayBuffer | Blob | string;

function toBlob(content: FileContent): Blob {
  return content instanceof Blob ? content : new Blob([content]);
}

/**
 * @routing Use when writing, creating, reading or editing a document of any kind, such as a brief, notes, a spec, a canvas, a spreadsheet or a deck; not databases, tasks or email.
 *
 * @agent
 * ## Changing a document's text
 *
 * Change the text of an existing Markdown document or task body in place, with `document.edit(instructions)` in code or the `EditDocument` tool where code isn't available. Never recreate the document or upload its Markdown to change its text. PDF, Word and other uploaded files can't be edited this way.
 *
 * When a program already holds the exact new Markdown, as an integration syncing from another system does, read `document.contentWithRevision()` and write with `document.setContent(markdown, {expectedRevision})`: the write lands only if nobody changed the document since the read, and throws `DocumentChangedError` otherwise, so read again and reapply instead of overwriting.
 * ## Uploaded Office and design files
 *
 * Edit an uploaded Word file with `readWord()` then `editWord(operations)`, and a PowerPoint deck with `readPresentation()` then `editPresentation(operations)` (or `copyPresentation()` for a new deck): both address paragraphs, slides and shapes by the ids the read reports. Read Figma, Photoshop and Illustrator files with `readDesign()`, `readPhotoshop()` and `readIllustrator()`; they can't be edited. Never rebuild these files from `bytes()`.
 *
 * ## New spreadsheets
 *
 * `createSpreadsheet` saves the spreadsheet before it returns, so it exists even when a later step of the program throws. Keep its id across that failure: fill it inside `try`/`catch` and return `{ data: { spreadsheet: sheet, error } }` (the handle serializes as its `id` and `url`). To retry, reopen it with `macro.documents.spreadsheet(macro.documents.byId(id))`; never search recent documents for it or create another.
 *
 * ## Linking Macro items inside document content
 *
 * `CreateDocument` content (the `fileContent` argument) is rendered with the same Markdown parser used for chat responses, channel messages, and email bodies inside the Macro app — but only for Markdown (`.md`) documents. Non-Markdown documents (e.g. PDF, CSV, PNG, XLSX, DOCX, created by passing a non-`md` `file_extension`) are stored as raw file bytes and must never contain Markdown syntax or mention tags.
 *
 * For Markdown document content, link to other Macro documents, channels, chats, projects, tasks, or email threads using `<m-document-mention>` XML mention tags, e.g.:
 *
 * `<m-document-mention>{"documentId":"{id}","documentName":"","blockName":"md","blockParams":{}}</m-document-mention>`
 *
 * The same Markdown parser also renders the other in-app chip tags: `<m-date-mention>` for a day or time, `<m-agent-session-mention>` for an agent session (add `"expanded":true` for the card that follows the latest turn), `<m-user-mention>` / `<m-contact-mention>` / `<m-group-mention>` for people and groups, `<m-pr-mention>` for a pull request, and `<m-booking-link-mention>` for a booking link. Use those tags in document content the same way you would in a chat reply.
 *
 * Reference a GitHub pull request with a PR chip rather than a Markdown link or bare URL: `<m-pr-mention>{"url":"https://github.com/{owner}/{repo}/pull/{number}","label":""}</m-pr-mention>`. Put the PR's github.com URL in `url`; no Macro id is needed. This applies to Markdown document content and to `SendChannelMessage` content, which uses the same Markdown syntax. The chip shows the PR's number, title, and live status and opens it in Macro, so leave `label` empty and do not repeat the number or title beside it. Issues, commits, and other GitHub pages stay Markdown links. Your own chat replies to the MCP client still link pull requests as plain Markdown URLs.
 *
 * Reference a Macro booking link with a booking-link chip rather than a Markdown link or bare URL: `<m-booking-link-mention>{"profileId":"{profile_id}","slug":"{slug}","url":"{booking_url}","label":""}</m-booking-link-mention>` (`slug` optional when linking the profile page). Put the shareable URL in `url` and the path's profile id (and slug when present) in `profileId`/`slug`. Leave `label` empty. Your own chat replies to the MCP client still link booking pages as plain Markdown URLs.
 *
 * This holds true even when `CreateDocument` is called through the MCP server, where you are otherwise told to link items in your own chat replies as plain Markdown URLs — that rule is about your conversational responses to the MCP client, not about content you write into a Macro document. Do NOT use plain Markdown links or bare URLs to reference other Macro items inside document content; only `<m-document-mention>` tags (and the other chip tags above) render as working links there.
 *
 * The same applies to `EditDocument`: when its `instructions` ask for a mention chip (person, date/time, document, agent session, booking link, and so on) or a document-card, include the referenced item's ids and details so the editing worker can construct the correct in-app markup itself. Date chips need an ISO datetime and displayFormat; they do not need a looked-up id. Booking-link chips need profileId, url, and slug when the URL has one.
 */
export class DocumentNamespace {
  /**
   * Resolve a team task reference such as ENG-42.
   *
   * @readonly
   */
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

  /**
   * Validate a permissions token, returning its document and optional user handles.
   *
   * @readonly
   */
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

  /**
   * Upload a file as a new document, up to 25 MiB: generated output such as a
   * CSV, a rendered PDF or an image, or bytes read with `Document.bytes()`.
   * Use `create` for Markdown you want to edit in Macro.
   *
   * `name` is the filename with its extension, which sets the file type
   * (`report.pdf`, `data.csv`). `content` is the file's bytes, or a string
   * stored as UTF-8 text. Uploading into `project` needs edit access to it.
   * The document is ready to read and attach when this resolves; its preview
   * and search indexing finish shortly after.
   *
   * @example Upload a generated CSV and share it in a channel.
   * ```js
   * const rows = [['name', 'amount'], ['Acme', 1200]];
   * const file = await macro.documents.upload({
   *   name: 'invoices.csv',
   *   content: rows.map((row) => row.join(',')).join('\n'),
   * });
   * await channel.send('Invoices attached.', { documents: [file] });
   * ```
   *
   * @write
   */
  async upload(options: {
    name: string;
    content: FileContent;
    project?: Project;
  }): Promise<Document> {
    const { documentId } = unwrap(
      await this.client.storage.uploadFile({
        query: { fileName: options.name, projectId: options.project?.id },
        body: toBlob(options.content),
      }),
    );
    return Document.byId(this.client, documentId);
  }

  /**
   * Reserve a binary document and return a presigned URL to PUT its content
   * to. The URL is outside the hosts code mode can reach; use `upload` there.
   *
   * @write
   */
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

  /**
   * Create a markdown document.
   *
   * @write
   */
  create(opts: {
    name: string;
    markdown?: string;
    project?: Project;
  }): Promise<Document> {
    return Document.create(this.client, opts);
  }

  /**
   * Create a native Canvas with shared content ready for reading and editing;
   * work on it with `document.canvas()`.
   *
   * @write
   */
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

  /**
   * Create a blank native spreadsheet, ready to read and edit; fill it with
   * `applyEdits`. It is saved before this returns: keep its `id` even when
   * filling it fails, and reopen it by id rather than creating another.
   *
   * @example Create and fill a budget, keeping the spreadsheet if a step fails.
   * ```js
   * const sheet = await macro.documents.createSpreadsheet({ name: 'Q4 budget' });
   * try {
   *   const { revision, sheets } = await sheet.read();
   *   await sheet.applyEdits(
   *     [{ type: 'set_cells', sheetId: sheets[0].id, cells: [
   *       { address: 'A1', value: 'Item' }, { address: 'B1', value: 'Cost' },
   *       { address: 'A2', value: 'Laptops' }, { address: 'B2', value: 4200 },
   *       { address: 'A3', value: 'Total' }, { address: 'B3', value: '=SUM(B2:B2)' },
   *     ] }],
   *     { expectedRevision: revision },
   *   );
   *   return { data: { spreadsheet: sheet } };
   * } catch (error) {
   *   return { data: { spreadsheet: sheet, error: String(error) } };
   * }
   * ```
   *
   * @write
   */
  async createSpreadsheet(opts: {
    name: string;
    project?: Project;
  }): Promise<Spreadsheet> {
    const result = unwrap(
      await this.client.storage.createSpreadsheet({
        body: { documentName: opts.name, projectId: opts.project?.id },
      }),
    );
    return Spreadsheet.byId(this.client, result.documentId);
  }

  /**
   * Read, calculate and edit a document as a native spreadsheet, such as a
   * search result or mention. Its methods refuse a document of another type.
   *
   * @readonly
   */
  spreadsheet(document: Document): Spreadsheet {
    return Spreadsheet.byId(this.client, document.id);
  }

  /**
   * Create a snippet: a reusable markdown document.
   *
   * @write
   */
  createSnippet(opts: {
    name: string;
    markdown?: string;
    project?: Project;
  }): Promise<Document> {
    return Document.createSnippet(this.client, opts);
  }

  /**
   * Create a skill: markdown instructions that AI reads and follows.
   *
   * A skill is a markdown document, so read one with `content()`, by the id of
   * a skill mention or of a search result:
   *
   * ```js
   * const skill = macro.documents.byId(skillId);
   * const instructions = await skill.content();
   * ```
   *
   * Read a skill the request names before doing the task, and follow it for
   * that request only. Find skills, built-in ones included, with `skills()`.
   *
   * `description` says when to use the skill, in one line starting "Use when"
   * (at most 300 characters); agents load the skill for requests it describes.
   *
   * @write
   */
  createSkill(opts: {
    name: string;
    description: string;
    markdown?: string;
    project?: Project;
  }): Promise<Document> {
    return Document.createSkill(this.client, opts);
  }

  /**
   * Find skills by name, or list them, built-in skills included; read the
   * instructions of the one a request needs with `skill.content()` before
   * doing the task, and follow them for that request only.
   *
   * With `query`, searches skill names: pass 1-3 words that literally appear
   * in the name, matched as one adjacent phrase whose last word may be a
   * prefix (`matchType: 'exact'` for whole words). Without it, lists the 100
   * most recently updated skills. User skills come first, most recently
   * updated first, then built-in skills.
   *
   * ```js
   * const [match] = await macro.documents.skills({ query: 'deploy' });
   * const instructions = match && (await match.skill.content());
   * ```
   *
   * @readonly
   */
  async skills(opts?: {
    query?: string;
    matchType?: 'partial' | 'exact';
  }): Promise<SkillListing[]> {
    const { skills } = unwrap(
      await this.client.cognition.listSkills({
        query: { query: opts?.query, matchType: opts?.matchType },
      }),
    );
    return skills.map((listing) => ({
      skill: listing.builtIn
        ? SystemSkill.from(this.client, listing)
        : Document.byId(this.client, listing.id),
      name: listing.name,
      description: listing.description ?? undefined,
      updatedAt: listing.updatedAt ?? undefined,
    }));
  }

  /**
   * The built-in system skills: static AI instructions with no document
   * behind them. Unlike user skills they cannot be opened or edited; read
   * their instructions with `content()`.
   *
   * @readonly
   */
  systemSkills(): Promise<SystemSkill[]> {
    return SystemSkill.list(this.client);
  }

  /**
   * Search documents by name and content, most relevant first, auto-paginated.
   *
   * @readonly
   */
  search(query: string, opts?: SearchOpts): AsyncGenerator<Document> {
    return Document.search(this.client, query, opts);
  }

  /**
   * The user's recent documents, most recent first, auto-paginated.
   *
   * @readonly
   */
  recent(opts?: {
    pageSize?: number;
    fileType?: string;
  }): AsyncGenerator<Document> {
    return Document.recent(this.client, opts);
  }

  /**
   * The user's recently soft-deleted documents.
   *
   * @readonly
   */
  recentlyDeleted(): Promise<Document[]> {
    return Document.recentlyDeleted(this.client);
  }
}
