import { MemoryRouter, Route } from '@solidjs/router';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { type JSX, Suspense } from 'solid-js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CoveragePage } from './components/CoveragePage';
import { DocPage } from './components/DocPage';
import { coverageRows, DOC_ENTRIES } from './registry';
import UiGallery from './UiGallery';

vi.mock('@components/app/split-layout/components/SplitHeader', () => ({
  SplitHeaderLeft: (props: { children: JSX.Element }) => props.children,
  SplitHeaderRight: (props: { children: JSX.Element }) => props.children,
}));

vi.mock('@components/app/split-layout/components/SplitLabel', () => ({
  StaticSplitLabel: (props: { label: string }) => <span>{props.label}</span>,
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

afterEach(cleanup);

function renderGallery() {
  return render(() => (
    <MemoryRouter>
      <Route path="/" component={UiGallery} />
    </MemoryRouter>
  ));
}

describe('UiGallery', () => {
  it('renders the sidebar with every documented component', () => {
    renderGallery();
    const search = screen.getByRole('searchbox', {
      name: 'Search components',
    });
    expect(search.dataset.slot).toBe('input-group-control');
    const inputGroup = search.closest('[data-slot="input-group"]');
    expect(inputGroup?.classList).toContain('bg-input');
    expect(search.classList).toContain('bg-transparent');
    expect(search.classList).toContain(
      '[&::-webkit-search-cancel-button]:hidden'
    );
    for (const entry of DOC_ENTRIES) {
      expect(screen.getAllByText(entry.doc.name).length).toBeGreaterThan(0);
    }
  });

  it('shows Foundation Colors when no page is selected', () => {
    renderGallery();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Colors' })
    ).toBeTruthy();
  });

  it('hides page code by default and toggles all examples from the header', async () => {
    const { container } = renderGallery();
    const toggle = screen.getByRole('switch', { name: 'Show code' });

    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect(container.querySelectorAll('pre')).toHaveLength(0);

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(container.querySelectorAll('pre').length).toBeGreaterThan(0);
    });

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(container.querySelectorAll('pre')).toHaveLength(0);
    });
  });

  it('offers the coverage report', () => {
    renderGallery();
    expect(screen.getByText('Coverage')).toBeTruthy();
  });
});

describe('CoveragePage', () => {
  it('renders the coverage report', () => {
    render(() => <CoveragePage onSelect={() => {}} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Coverage' })
    ).toBeTruthy();
  });

  it('lists every ui component with its documentation status', () => {
    render(() => <CoveragePage onSelect={() => {}} />);
    for (const row of coverageRows()) {
      expect(screen.getAllByText(row.name).length).toBeGreaterThan(0);
    }
  });
});

describe('DocPage suspense safety', () => {
  // The split layout wraps panel content in a <Suspense> with no fallback
  // (SplitLayout.tsx), so a resource read that is still pending detaches the
  // whole pane and renders nothing — silently, with no console error. Every
  // resource read in DocPage is gated on state for this reason.
  it('renders without suspending while its resources are still pending', () => {
    const entry = DOC_ENTRIES.find((e) => e.doc.name === 'Button');
    if (!entry) throw new Error('Button page missing');

    const { container } = render(() => (
      <Suspense fallback={<span data-testid="suspended">suspended</span>}>
        <DocPage entry={entry} showCode={false} />
      </Suspense>
    ));

    expect(container.querySelector('[data-testid="suspended"]')).toBeNull();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Button' })
    ).toBeTruthy();
  });
});
