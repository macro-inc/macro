import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomepageEmailCompose from './HomepageEmailCompose';
import HomepageSpreadsheet from './HomepageSpreadsheet';

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.reject(new Error('Website demos must not call app services'))
    )
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('standalone website demos', () => {
  it('opens Bcc, edits the draft, and sends only within the local demo', () => {
    const view = render(() => <HomepageEmailCompose />);
    expect(
      (view.getByRole('textbox', { name: 'To' }) as HTMLInputElement).value
    ).toBe('Valentina <valentina@coparse.com>');
    expect(
      (view.getByRole('textbox', { name: 'Cc' }) as HTMLInputElement).value
    ).toBe('Julia <julia@macro.com>');
    expect(
      view.getByRole('textbox', { name: 'Email body' }).textContent
    ).toContain('Thanks for joining the demo');
    fireEvent.click(view.getByRole('button', { name: 'Bcc' }));
    fireEvent.input(view.getByRole('textbox', { name: 'Bcc' }), {
      target: { value: 'review@example.com' },
    });
    fireEvent.input(view.getByRole('textbox', { name: 'Subject' }), {
      target: { value: 'Local follow-up' },
    });
    fireEvent.click(view.getByRole('button', { name: 'Send email' }));
    expect(view.getByRole('status').textContent).toContain(
      'Sent in this demo.'
    );
    expect(
      view.getByRole('textbox', { name: 'Subject' }).getAttribute('disabled')
    ).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Edit again' }));
    expect(view.queryByRole('status')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps attachments local and rejects a total over the size limit', () => {
    const view = render(() => <HomepageEmailCompose />);
    const file = new File(['demo attachment'], 'notes.txt', {
      type: 'text/plain',
    });
    fireEvent.change(view.getByLabelText('Choose attachments'), {
      target: { files: [file] },
    });
    expect(view.getByText('notes.txt')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Remove notes.txt' }));
    expect(view.queryByText('notes.txt')).toBeNull();
    const largeFile = new File(['x'], 'large.txt');
    Object.defineProperty(largeFile, 'size', { value: 19 * 1024 * 1024 });
    fireEvent.change(view.getByLabelText('Choose attachments'), {
      target: { files: [largeFile] },
    });
    expect(view.getByRole('alert').textContent).toContain('18 MB');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('opens company and person mentions locally and preserves the sheet on return', async () => {
    const view = render(() => <HomepageSpreadsheet />);
    const company = view.getByRole('button', { name: 'Open Coparse' });
    fireEvent.click(company);
    // The first linked record loads a separate chunk; include its cold test transform.
    const dialog = await screen.findByRole(
      'dialog',
      { name: 'Coparse' },
      { timeout: 3000 }
    );
    expect(
      (
        within(dialog).getByRole('textbox', {
          name: 'Company name',
        }) as HTMLInputElement
      ).value
    ).toBe('Coparse');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Close linked record' })
    );
    expect(
      view
        .getByRole('gridcell', { name: 'B2: Coparse' })
        .getAttribute('aria-selected')
    ).toBe('true');
    fireEvent.click(view.getByRole('button', { name: 'Open Valentina' }));
    const contact = await screen.findByRole('dialog', {
      name: 'Valentina · Coparse',
    });
    expect(within(contact).getByText('valentina@coparse.com')).toBeTruthy();
    fireEvent.click(
      within(contact).getByRole('button', { name: 'Close linked record' })
    );
    const cell = view.getByRole('gridcell', { name: 'B2: Coparse' });
    fireEvent.click(cell);
    fireEvent.dblClick(cell);
    fireEvent.input(view.getByRole('textbox', { name: 'Edit B2' }), {
      target: { value: 'New company' },
    });
    fireEvent.keyDown(view.getByRole('textbox', { name: 'Edit B2' }), {
      key: 'Enter',
    });
    expect(view.queryByRole('button', { name: 'Open New company' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Undo' }));
    expect(view.getByRole('button', { name: 'Open Coparse' })).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('edits cells, commits keyboard navigation, and restores edits with undo and redo', () => {
    const view = render(() => <HomepageSpreadsheet />);
    expect(view.getByRole('gridcell', { name: 'B2: Coparse' })).toBeTruthy();
    expect(
      view.getByRole('gridcell', { name: 'C3: maya@lumen.example' })
    ).toBeTruthy();
    expect(
      view.getByRole('gridcell', { name: 'C4: owen@fieldnote.example' })
    ).toBeTruthy();
    const cell = view.getByRole('gridcell', {
      name: 'A2: Valentina',
    });
    fireEvent.click(cell);
    fireEvent.dblClick(cell);
    fireEvent.input(view.getByRole('textbox', { name: 'Edit A2' }), {
      target: { value: 'Valentina Test' },
    });
    fireEvent.keyDown(view.getByRole('textbox', { name: 'Edit A2' }), {
      key: 'Enter',
    });
    expect(
      view.getByRole('gridcell', { name: 'A2: Valentina Test' })
    ).toBeTruthy();
    expect(
      view
        .getByRole('gridcell', { name: 'A3: Maya' })
        .getAttribute('aria-selected')
    ).toBe('true');
    fireEvent.click(view.getByRole('button', { name: 'Undo' }));
    expect(view.getByRole('gridcell', { name: 'A2: Valentina' })).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Redo' }));
    expect(
      view.getByRole('gridcell', { name: 'A2: Valentina Test' })
    ).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Bold' }));
    expect(
      view.getByRole('gridcell', { name: 'A3: Maya' }).style.fontWeight
    ).toBe('700');
    expect(fetch).not.toHaveBeenCalled();
  });
});
