import { render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EmailAttachmentPill } from './attachment-pill';

// EntityIcon imports the block registry, which initializes app services. This
// covers the pill's keyboard behavior, not isolation of the shared icon.
const entityIconMock = vi.fn(() => null);
vi.mock('@core/component/EntityIcon', () => ({
  EntityIcon: (props: { targetType: string }) => {
    entityIconMock(props);
    return null;
  },
}));

it('opens attachments with Enter and Space, while removal stays a separate keyboard action', async () => {
  const open = vi.fn();
  const remove = vi.fn();
  const user = userEvent.setup();
  const view = render(() => (
    <>
      <EmailAttachmentPill attachment={{ fileName: 'readonly.txt' }} />
      <EmailAttachmentPill
        attachment={{ fileName: 'agenda.pdf' }}
        onClick={open}
        removable
        onRemove={remove}
      />
    </>
  ));
  try {
    await user.tab();
    expect(document.activeElement).toBe(
      view.getByRole('button', { name: 'agenda.pdf' })
    );
    await user.keyboard('{Enter} ');
    expect(open).toHaveBeenCalledTimes(2);
    await user.tab();
    expect(document.activeElement).toBe(
      view.getByRole('button', { name: 'Remove agenda.pdf' })
    );
    await user.keyboard('{Enter}');
    expect(remove).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledTimes(2);
  } finally {
    view.unmount();
  }
});

describe('file type resolution', () => {
  it('resolves CSV file type from filename when MIME type is text/csv', () => {
    entityIconMock.mockClear();
    const view = render(() => (
      <EmailAttachmentPill
        attachment={{ fileName: 'data.csv', mimeType: 'text/csv' }}
      />
    ));
    try {
      expect(screen.getByText('data.csv')).toBeTruthy();
      expect(entityIconMock).toHaveBeenCalledWith(
        expect.objectContaining({ targetType: 'csv' })
      );
    } finally {
      view.unmount();
    }
  });

  it('uses MIME type when it maps to a known file type', () => {
    entityIconMock.mockClear();
    const view = render(() => (
      <EmailAttachmentPill
        attachment={{ fileName: 'doc.pdf', mimeType: 'application/pdf' }}
      />
    ));
    try {
      expect(entityIconMock).toHaveBeenCalledWith(
        expect.objectContaining({ targetType: 'pdf' })
      );
    } finally {
      view.unmount();
    }
  });
});
