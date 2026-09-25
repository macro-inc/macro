import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomepageEmailCompose from './HomepageEmailCompose';
import HomepageSpreadsheet from './HomepageSpreadsheet';

beforeEach(() => {
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

  it('edits cells, commits keyboard navigation, and restores edits with undo and redo', () => {
    const view = render(() => <HomepageSpreadsheet />);
    const cell = view.getByRole('gridcell', {
      name: 'A2: Dana Whitfield',
    });
    fireEvent.click(cell);
    fireEvent.dblClick(cell);
    fireEvent.input(view.getByRole('textbox', { name: 'Edit A2' }), {
      target: { value: 'Dana Test' },
    });
    fireEvent.keyDown(view.getByRole('textbox', { name: 'Edit A2' }), {
      key: 'Enter',
    });
    expect(view.getByRole('gridcell', { name: 'A2: Dana Test' })).toBeTruthy();
    expect(
      view
        .getByRole('gridcell', { name: 'A3: Maya Chen' })
        .getAttribute('aria-selected')
    ).toBe('true');
    fireEvent.click(view.getByRole('button', { name: 'Undo' }));
    expect(
      view.getByRole('gridcell', { name: 'A2: Dana Whitfield' })
    ).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Redo' }));
    expect(view.getByRole('gridcell', { name: 'A2: Dana Test' })).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Bold' }));
    expect(
      view.getByRole('gridcell', { name: 'A3: Maya Chen' }).style.fontWeight
    ).toBe('700');
    expect(fetch).not.toHaveBeenCalled();
  });
});
