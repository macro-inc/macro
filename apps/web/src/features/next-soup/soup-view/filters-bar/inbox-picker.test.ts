import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { useInboxPicker } from './inbox-picker';

vi.mock('@queries/email/link', () => ({
  useEmailLinksQuery: () => ({
    data: {
      links: [
        { id: 'a', email_address: 'a@example.com', photo_url: null },
        { id: 'b', email_address: 'b@example.com', photo_url: null },
        { id: 'c', email_address: 'c@example.com', photo_url: null },
      ],
    },
  }),
}));
vi.mock('@core/component/inboxIcon', () => ({ inboxIconProps: () => ({}) }));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));

const setup = (initial?: string[]) =>
  createRoot((dispose) => {
    const [selectedIds, setSelectedIds] = createSignal<string[] | undefined>(
      initial
    );
    const picker = useInboxPicker({ selectedIds, setSelectedIds });
    return { picker, selectedIds, dispose };
  });

describe('useInboxPicker selectOnly', () => {
  it('narrows to the clicked inbox from the all-selected default', () => {
    const { picker, selectedIds, dispose } = setup(undefined);
    picker.selectOnly('a');
    expect(selectedIds()).toEqual(['a']);
    dispose();
  });

  it('flips back to all when the clicked inbox is already the sole selection', () => {
    const { picker, selectedIds, dispose } = setup(['a']);
    picker.selectOnly('a');
    expect(selectedIds()).toBeUndefined();
    dispose();
  });

  it('narrows to a different inbox when another is the sole selection', () => {
    const { picker, selectedIds, dispose } = setup(['a']);
    picker.selectOnly('b');
    expect(selectedIds()).toEqual(['b']);
    dispose();
  });

  it('narrows to the clicked inbox from a multi-selection that includes it', () => {
    const { picker, selectedIds, dispose } = setup(['a', 'b']);
    picker.selectOnly('a');
    expect(selectedIds()).toEqual(['a']);
    dispose();
  });
});
