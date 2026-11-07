import { readSharedCanvas } from '@app/features/block-canvas/core/collaboration';
import { throwOnErr } from '@core/util/result';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { emailClient } from '@service-email/client';
import { storageServiceClient } from '@service-storage/client';
import type { PostSoupAstRequest } from '@service-storage/generated/schemas/postSoupAstRequest';
import type { SoupApiItem } from '@service-storage/generated/schemas/soupApiItem';
import {
  entityMessagesClient,
  type MessageParent,
  type MessageThread,
} from '@service-storage/messages';
import { downloadExportedDocument } from '@service-storage/util/downloadExportedDocument';
import { syncServiceClient } from '@service-sync/client';
import { LoroDoc } from 'loro-crdt';
import { match } from 'ts-pattern';
import type { ArchiveFile } from '../core/archive';
import { FILES, type WorkspaceListing } from '../core/plan';
import type { WorkspaceSource } from '../primitives/workspace-archive';

const PAGE_SIZE = 500;
const MESSAGE_PAGE_SIZE = 100;
const EMAIL_PAGE_SIZE = 50;

/**
 * Every type the workspace listing serves, including the opt-in ones
 * (agent sessions, projects/initiatives, CRM contacts) and all mail rather
 * than just the inbox.
 */
const EVERYTHING: PostSoupAstRequest = {
  asf: { l: 'inc' },
  if: { l: 'inc' },
  crmf: { l: 'include' },
  emailView: 'all',
  expand: true,
  limit: PAGE_SIZE,
};

const encoder = new TextEncoder();

function json(name: string, value: unknown): ArchiveFile {
  return { name, bytes: encoder.encode(JSON.stringify(value)) };
}

function field(data: unknown, key: string): unknown {
  return typeof data === 'object' && data !== null
    ? Object.getOwnPropertyDescriptor(data, key)?.value
    : undefined;
}

function itemId(item: SoupApiItem): string {
  if (item.tag === 'call') return item.data.callId;
  if (item.tag === 'channel') return item.data.channel.id;
  return item.data.id;
}

async function* listWorkspace(): AsyncGenerator<WorkspaceListing> {
  let cursor: string | null | undefined;
  do {
    const page = await throwOnErr(() =>
      storageServiceClient.getSoupAstItems({
        params: { cursor },
        body: EVERYTHING,
      })
    );
    for (const item of page.items)
      yield {
        kind: item.tag,
        id: itemId(item),
        data: item.data,
      };
    cursor = page.next_cursor;
  } while (cursor);
}

/** Every discussion on a parent, each with all of its replies. */
async function messageThreads(parent: MessageParent): Promise<MessageThread[]> {
  const threads: MessageThread[] = [];
  let cursor: Awaited<
    ReturnType<typeof entityMessagesClient.list>
  >['next_cursor'];
  do {
    const page = await entityMessagesClient.list(parent, {
      cursor,
      direction: 'older',
      limit: MESSAGE_PAGE_SIZE,
    });
    for (const root of page.items) {
      threads.push(
        root.thread.reply_count > root.thread.preview.length
          ? await entityMessagesClient.thread(parent, root.id)
          : { root, replies: root.thread.preview, state: root.state }
      );
    }
    cursor = page.next_cursor;
  } while (cursor);
  return threads;
}

async function messages(parent: MessageParent): Promise<ArchiveFile[]> {
  const threads = await messageThreads(parent);
  return threads.length > 0 ? [json(FILES.messages, threads)] : [];
}

async function collabSnapshot(documentId: string) {
  return throwOnErr(() => syncServiceClient.getSnapshot({ documentId }));
}

function canvasJson(documentId: string, snapshot: Uint8Array): ArchiveFile {
  const doc = new LoroDoc();
  try {
    doc.import(snapshot);
    return json(FILES.canvas, readSharedCanvas(doc, documentId));
  } finally {
    doc.free();
  }
}

async function documentContent(
  listing: WorkspaceListing
): Promise<ArchiveFile[]> {
  const id = listing.id;
  const comments = await messages({ type: 'document', id });
  const fileType = field(listing.data, 'fileType');
  if (fileType === 'md') {
    const [text, snapshot] = await Promise.all([
      throwOnErr(() =>
        storageServiceClient.getDocumentTextContent({ documentId: id })
      ),
      collabSnapshot(id),
    ]);
    return [
      { name: FILES.markdown, bytes: encoder.encode(text.text ?? '') },
      { name: FILES.collab, bytes: snapshot },
      ...comments,
    ];
  }
  if (fileType === 'canvas') {
    const snapshot = await collabSnapshot(id);
    return [
      canvasJson(id, snapshot),
      { name: FILES.collab, bytes: snapshot },
      ...comments,
    ];
  }
  const original = await downloadExportedDocument({ documentId: id });
  return [{ name: FILES.original, bytes: original }, ...comments];
}

/** The thread as the app shows it, plus every message's original `.eml`. */
async function emailContent(threadId: string): Promise<ArchiveFile[]> {
  const files: ArchiveFile[] = [];
  const pages = [];
  for (let offset = 0; ; offset += EMAIL_PAGE_SIZE) {
    const page = await throwOnErr(() =>
      emailClient.getThread({
        thread_id: threadId,
        offset,
        limit: EMAIL_PAGE_SIZE,
      })
    );
    pages.push(page.thread);
    for (const message of page.thread.messages) {
      const eml = await throwOnErr(() =>
        emailClient.getMessageEml({ message_id: message.db_id })
      );
      files.push({ name: `${message.db_id}.eml`, bytes: new Uint8Array(eml) });
    }
    if (page.thread.messages.length < EMAIL_PAGE_SIZE) break;
  }
  const [first] = pages;
  const thread = first && {
    ...first,
    messages: pages.flatMap((page) => page.messages),
  };
  return [json(FILES.emailThread, thread), ...files];
}

async function content(listing: WorkspaceListing): Promise<ArchiveFile[]> {
  const id = listing.id;
  return match(listing.kind)
    .with('document', () => documentContent(listing))
    .with('chat', async () => [
      json(
        FILES.chat,
        await throwOnErr(() =>
          cognitionApiServiceClient.getChat({ chat_id: id })
        )
      ),
    ])
    .with('channel', () => messages({ type: 'channel', id }))
    .with('call', () => messages({ type: 'call', id }))
    .with('initiative', () => messages({ type: 'initiative', id }))
    .with('crmCompany', () => messages({ type: 'crm_company', id }))
    .with('crmContact', () => messages({ type: 'crm_contact', id }))
    .with('emailThread', () => emailContent(id))
    .otherwise(async () => []);
}

export const workspaceSource: WorkspaceSource = {
  list: listWorkspace,
  content,
};
