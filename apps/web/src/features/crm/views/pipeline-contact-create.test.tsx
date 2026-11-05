import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseMention } from '../../database/core/column-inference';
import { usePipelineContactCellCreate } from './pipeline-contact-create';

vi.mock('./create-contact', () => ({
  CreateContactModal: (props: {
    initialName: string;
    onClose: () => void;
    onCreated: (id: string, name: string) => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() => {
          props.onClose();
          props.onCreated('contact-1', 'Ada');
        }}
      >
        Save {props.initialName}
      </button>
      <button type="button" onClick={props.onClose}>
        Dismiss
      </button>
    </div>
  ),
}));

function Host(props: { onSelect: (mention: DatabaseMention) => void }) {
  const create = usePipelineContactCellCreate();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          create.forCell('CONTACT', props.onSelect)?.('Ada Lovelace')
        }
      >
        Search
      </button>
      <button
        type="button"
        onClick={() => create.forCell('COMPANY', props.onSelect)?.('Acme')}
      >
        Company
      </button>
      {create.dialog()}
    </>
  );
}

afterEach(cleanup);

describe('pipeline contact cell creation', () => {
  it('writes the created contact into the cell that searched for them', () => {
    const onSelect = vi.fn();
    render(() => <Host onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Company' }));
    expect(screen.queryByRole('button', { name: 'Save Acme' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Ada Lovelace' }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({
      id: 'contact-1',
      entityType: 'CONTACT',
      label: 'Ada',
    });
    expect(
      screen.queryByRole('button', { name: 'Save Ada Lovelace' })
    ).toBeNull();
  });

  it('drops a dismissed create without writing the cell', () => {
    const onSelect = vi.fn();
    render(() => <Host onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'Save Ada Lovelace' })
    ).toBeNull();
  });
});
