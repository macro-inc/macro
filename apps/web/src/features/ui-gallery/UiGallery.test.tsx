import { MemoryRouter, Route } from '@solidjs/router';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CoveragePage } from './components/CoveragePage';
import { coverageRows, DOC_ENTRIES } from './registry';
import UiGallery from './UiGallery';

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
    for (const entry of DOC_ENTRIES) {
      expect(screen.getAllByText(entry.doc.name).length).toBeGreaterThan(0);
    }
  });

  it('shows the first page when no page is selected', () => {
    renderGallery();
    const first = DOC_ENTRIES[0]!;
    expect(
      screen.getByRole('heading', { level: 1, name: first.doc.name })
    ).toBeTruthy();
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
