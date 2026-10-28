import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntityTimestamp } from '../extractors/entity-timestamp';
import type { EmailEntity, EntityData } from '../types/entity';

vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));

describe('EntityTimestamp attachment indicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 17, 12, 0));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows a paperclip next to the date of an email with an attached file', () => {
    const email: EmailEntity = {
      type: 'email',
      id: 'thread-with-pdf',
      name: 'Signed contract',
      ownerId: 'macro|owner@example.com',
      sortTs: new Date(2026, 9, 15, 9, 30).toISOString(),
      isRead: true,
      isDraft: false,
      isImportant: false,
      done: false,
      hasFileAttachment: true,
    };
    render(() => <EntityTimestamp entity={email} />);

    expect(screen.getByRole('img', { name: 'Has attachments' })).toBeTruthy();
    expect(screen.getByText('Oct 15')).toBeTruthy();
  });

  it('drops the paperclip when a recycled row moves to an email without files', () => {
    const [entity, setEntity] = createSignal<EntityData>({
      type: 'email',
      id: 'thread-with-pdf',
      name: 'Signed contract',
      ownerId: 'macro|owner@example.com',
      sortTs: new Date(2026, 9, 15, 9, 30).toISOString(),
      isRead: true,
      isDraft: false,
      isImportant: false,
      done: false,
      hasFileAttachment: true,
    });
    render(() => <EntityTimestamp entity={entity()} />);

    setEntity({
      type: 'email',
      id: 'thread-with-logo',
      name: 'Quick question',
      ownerId: 'macro|owner@example.com',
      sortTs: new Date(2026, 9, 14, 9, 30).toISOString(),
      isRead: true,
      isDraft: false,
      isImportant: false,
      done: false,
      hasFileAttachment: false,
    });

    expect(screen.queryByRole('img', { name: 'Has attachments' })).toBeNull();
    expect(screen.getByText('Oct 14')).toBeTruthy();
  });
});
