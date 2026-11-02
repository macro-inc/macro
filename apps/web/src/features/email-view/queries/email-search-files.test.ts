import type { EmailEntity, WithSearch } from '@entity';
import { describe, expect, it, vi } from 'vitest';
import {
  buildEmailSearchFileRows,
  collectEmailSearchFiles,
  type EmailSearchFile,
} from './email-search-files';

vi.mock(
  '@app/features/soup',
  async () => await import('@app/features/soup/collection/rows')
);
vi.mock('@entity', async () => await import('@entity/types/search'));

const thread = (id: string): EmailEntity => ({
  type: 'email',
  id,
  name: `Subject ${id}`,
  ownerId: 'viewer',
  isRead: true,
  isDraft: false,
  isImportant: true,
  done: false,
});

const detail = (
  id: string,
  attachments: EmailEntity['attachments']
): EmailEntity => ({
  ...thread(id),
  senderName: 'Latest Sender',
  senderEmail: 'latest@example.com',
  sortTs: '2026-10-10T09:00:00Z',
  attachments,
});

const details = (...threads: EmailEntity[]) =>
  new Map(threads.map((entity) => [entity.id, entity]));

const names = (files: EmailSearchFile[]) => files.map((file) => file.filename);

describe('collectEmailSearchFiles', () => {
  it('lists the attachments of matched threads with filename matches first', () => {
    const files = collectEmailSearchFiles(
      [thread('first'), thread('second')],
      details(
        detail('first', [
          { id: 'a1', filename: 'agenda.docx', mimeType: 'text/plain' },
        ]),
        detail('second', [
          { id: 'b1', filename: 'notes.txt', mimeType: 'text/plain' },
          { id: 'b2', filename: 'Q3 Invoice.pdf', mimeType: 'application/pdf' },
        ])
      ),
      'invoice q3'
    );

    expect(names(files)).toEqual([
      'Q3 Invoice.pdf',
      'agenda.docx',
      'notes.txt',
    ]);
    expect(files.map((file) => file.matchesQuery)).toEqual([
      true,
      false,
      false,
    ]);
    expect(files[0]).toMatchObject({
      attachmentId: 'b2',
      mimeType: 'application/pdf',
      thread: { id: 'second' },
    });
  });

  it('matches quoted search text by its terms', () => {
    const files = collectEmailSearchFiles(
      [thread('t')],
      details(detail('t', [{ id: 'a', filename: 'Board deck v2.key' }])),
      '"board deck"'
    );

    expect(files[0].matchesQuery).toBe(true);
  });

  it('skips inline images, calendar invites, unnamed parts, and repeated copies', () => {
    const files = collectEmailSearchFiles(
      [thread('t')],
      details(
        detail('t', [
          {
            id: 'logo',
            filename: 'image001.png',
            mimeType: 'image/png',
            contentId: '<logo@mail>',
          },
          { id: 'invite', filename: 'invite.ics', mimeType: 'text/calendar' },
          { id: 'unnamed', filename: '  ', mimeType: 'application/pdf' },
          {
            id: 'photo',
            filename: 'photo.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 10,
          },
          {
            id: 'contract',
            filename: 'contract.pdf',
            mimeType: 'application/pdf',
            contentId: '<contract@mail>',
            sizeBytes: 20,
          },
          {
            id: 'contract-again',
            filename: 'Contract.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 20,
          },
        ])
      ),
      'contract'
    );

    expect(files.map((file) => file.attachmentId)).toEqual([
      'contract',
      'photo',
    ]);
  });

  it("uses the matching message's sender and date, else the thread's latest", () => {
    const searched: WithSearch<EmailEntity> = {
      ...thread('t'),
      search: {
        nameHighlight: null,
        senderHighlightTerms: null,
        source: 'service',
        contentHitData: [
          {
            type: 'email',
            content: 'see the attached <macro_em>budget</macro_em>',
            sender: 'Original Sender',
            senderId: 'macro|original@example.com',
            sentAt: '2026-09-01T12:00:00Z',
            location: { type: 'email', messageId: 'm1' },
          },
        ],
      },
    };

    const files = collectEmailSearchFiles(
      [searched],
      details(
        detail('t', [
          { id: 'a', messageId: 'm1', filename: 'budget.xlsx' },
          { id: 'b', messageId: 'm2', filename: 'reply.pdf' },
        ])
      ),
      'budget'
    );

    expect(files.map(({ sender, sentAt }) => ({ sender, sentAt }))).toEqual([
      { sender: 'Original Sender', sentAt: '2026-09-01T12:00:00Z' },
      { sender: 'Latest Sender', sentAt: '2026-10-10T09:00:00Z' },
    ]);
  });

  it('is empty when the matched threads have no files or are not loaded yet', () => {
    expect(
      collectEmailSearchFiles(
        [thread('loaded'), thread('pending')],
        details(detail('loaded', [])),
        'anything'
      )
    ).toEqual([]);
    expect(collectEmailSearchFiles([], details(), 'anything')).toEqual([]);
  });
});

describe('buildEmailSearchFileRows', () => {
  const files = ['a', 'b', 'c', 'd', 'e'].map(
    (id): EmailSearchFile => ({
      attachmentId: id,
      filename: `${id}.pdf`,
      matchesQuery: true,
      thread: thread(id),
    })
  );
  const kinds = (rows: ReturnType<typeof buildEmailSearchFileRows>) =>
    rows.map((row) =>
      row.kind === 'email-file' ? row.file.filename : row.kind
    );

  it('hides the section when no file matches', () => {
    expect(buildEmailSearchFileRows([], false)).toEqual([]);
    expect(buildEmailSearchFileRows([], true)).toEqual([]);
  });

  it('shows a short preview with a toggle for the rest', () => {
    expect(kinds(buildEmailSearchFileRows(files, false))).toEqual([
      'section-header',
      'a.pdf',
      'b.pdf',
      'c.pdf',
      'email-files-toggle',
      'section-header',
    ]);
    expect(buildEmailSearchFileRows(files, false)[4]).toMatchObject({
      hiddenCount: 2,
      expanded: false,
    });
    expect(kinds(buildEmailSearchFileRows(files, true))).toEqual([
      'section-header',
      'a.pdf',
      'b.pdf',
      'c.pdf',
      'd.pdf',
      'e.pdf',
      'email-files-toggle',
      'section-header',
    ]);
  });

  it('omits the toggle when every file fits', () => {
    expect(kinds(buildEmailSearchFileRows(files.slice(0, 3), false))).toEqual([
      'section-header',
      'a.pdf',
      'b.pdf',
      'c.pdf',
      'section-header',
    ]);
  });
});
