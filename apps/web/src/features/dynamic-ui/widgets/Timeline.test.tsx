import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Timeline } from './Timeline';

vi.mock('@core/component/ItemPreview', () => ({
  ItemPreview: (props: { id: string; type?: string }) => (
    <span
      data-testid="item-preview"
      data-id={props.id}
      data-type={props.type}
    />
  ),
}));

afterEach(cleanup);

describe('timeline entity compatibility', () => {
  it('keeps database events readable without document previews or navigation', () => {
    render(() => (
      <Timeline
        events={[
          {
            time: 'Today',
            title: 'Database updated',
            entity: { id: 'database-id', type: 'database' },
          },
        ]}
      />
    ));
    expect(screen.getByText('Database updated')).toBeTruthy();
    expect(screen.queryByTestId('item-preview')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('keeps previews for supported document entities', () => {
    render(() => (
      <Timeline
        events={[
          {
            time: 'Today',
            title: 'Document updated',
            entity: { id: 'document-id', type: 'document' },
          },
        ]}
      />
    ));
    const preview = screen.getByTestId('item-preview');
    expect(preview.getAttribute('data-id')).toBe('document-id');
    expect(preview.getAttribute('data-type')).toBe('document');
  });
});
