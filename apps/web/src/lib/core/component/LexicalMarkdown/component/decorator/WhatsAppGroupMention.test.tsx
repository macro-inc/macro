import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { DocumentMention } from './DocumentMention';

const mocks = vi.hoisted(() => ({ openWithSplit: vi.fn() }));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: mocks.openWithSplit }),
}));
vi.mock('@core/component/EntityIcon', () => ({ EntityIcon: () => null }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));

afterEach(() => {
  cleanup();
  mocks.openWithSplit.mockClear();
});

it('shows a WhatsApp group mention by name and opens it inside External', () => {
  render(() => (
    <DocumentMention
      key="node-1"
      documentId="01a16445-9fdc-7bb1-80b4-8935a1243c98"
      documentName="Design Crit"
      blockName="whatsapp_group"
      theme={{}}
    />
  ));
  fireEvent.click(screen.getByRole('link', { name: /Design Crit/ }));
  expect(mocks.openWithSplit).toHaveBeenCalledWith(
    {
      type: 'component',
      id: 'external',
      entryMetadata: {
        route: {
          matches: [
            { id: 'app', params: {} },
            { id: 'view-external', params: {} },
            {
              id: 'external-whatsapp-group',
              params: { groupId: '01a16445-9fdc-7bb1-80b4-8935a1243c98' },
            },
          ],
        },
      },
    },
    { preferNewSplit: true }
  );
});
