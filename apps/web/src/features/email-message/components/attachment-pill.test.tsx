import { render } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { EmailAttachmentPill } from './attachment-pill';

// EntityIcon imports the block registry, which initializes app services. This
// covers the pill's keyboard behavior, not isolation of the shared icon.
vi.mock('@core/component/EntityIcon', () => ({ EntityIcon: () => null }));

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
