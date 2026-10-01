import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomepagePullRequest from './HomepagePullRequest';

const request = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', request);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => {
    request();
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  request.mockClear();
});

describe('website pull-request demo', () => {
  it('merges only the sample and shows its updated status without opening a session', async () => {
    render(() => <HomepagePullRequest />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Merge sample pull request' })
    );
    expect(
      screen
        .getByRole('button', { name: 'Sample pull request merged' })
        .hasAttribute('disabled')
    ).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(
      screen.getAllByRole('button', { name: 'View pull request #482' })[0]
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Merged')).toBeDefined();
    expect(
      within(dialog).getByRole('heading', { name: 'Fix flaky deploy pipeline' })
    ).toBeDefined();
    expect(within(dialog).getByText('+38')).toBeDefined();
    expect(within(dialog).getByText('−12')).toBeDefined();
    expect(within(dialog).getByText('All 12 retry tests pass')).toBeDefined();
    expect(request).not.toHaveBeenCalled();
  });

  it('opens the trace, expands tools and outputs, switches to the PR, and restores focus', async () => {
    render(() => <HomepagePullRequest />);
    const opener = screen.getByRole('button', { name: 'View session' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog');
    const view = within(dialog);
    fireEvent.click(view.getAllByRole('button', { name: 'Thought' })[0]);
    expect(
      view.getByText(/Teo has already started the pull request/)
    ).toBeDefined();
    fireEvent.click(view.getAllByRole('button', { name: 'Called 2 tools' })[0]);
    fireEvent.click(
      view.getByRole('button', { name: /Bash.*git branch --show-current/ })
    );
    expect(view.getByText('fix/deploy-flake')).toBeDefined();
    fireEvent.click(view.getByRole('button', { name: /Read.*3 files/ }));
    expect(view.getByText('deploy/retry.test.ts')).toBeDefined();
    expect(view.getByText('.github/workflows/deploy.yml')).toBeDefined();
    fireEvent.click(view.getByRole('button', { name: 'Called 1 tool' }));
    fireEvent.click(
      view.getByRole('button', { name: /Edit.*deploy\/retry.ts/ })
    );
    const diff = await view.findByLabelText('Changes to deploy/retry.ts');
    await waitFor(() =>
      expect(diff.shadowRoot?.textContent).toContain('isTransient(error)')
    );
    expect(view.getByText('+8')).toBeDefined();
    expect(view.getByText('−1')).toBeDefined();
    fireEvent.click(view.getAllByRole('button', { name: 'Called 2 tools' })[1]);
    fireEvent.click(
      view.getByRole('button', { name: /Bash.*bun test deploy\/retry.test.ts/ })
    );
    expect(view.getByText(/12 passed · 0 failed/)).toBeDefined();
    fireEvent.click(view.getByRole('radio', { name: 'Pull request #482' }));
    await waitFor(() =>
      expect(
        view.getByRole('heading', { name: 'Fix flaky deploy pipeline' })
      ).toBeDefined()
    );
    expect(view.getByText('Open', { exact: true })).toBeDefined();
    fireEvent.click(view.getByRole('button', { name: 'Close agent trace' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(request).not.toHaveBeenCalled();
  });
});
