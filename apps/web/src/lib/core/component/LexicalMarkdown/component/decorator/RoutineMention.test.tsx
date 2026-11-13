import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { DocumentMention } from './DocumentMention';

type RoutinePreview =
  | { loading: true; id: string; type: 'routine' }
  | {
      loading: false;
      id: string;
      type: 'routine';
      access: 'access';
      name: string;
    };

const mocks = vi.hoisted(() => ({
  preview: {
    loading: true,
    id: 'routine-1',
    type: 'routine',
  } as RoutinePreview,
}));
vi.mock('@core/component/ItemPreview', () => ({
  useItemPreviewData: () => ({ item: () => mocks.preview }),
}));
vi.mock('@core/component/EntityIcon', () => ({ EntityIcon: () => null }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));

afterEach(() => {
  cleanup();
  mocks.preview = { loading: true, id: 'routine-1', type: 'routine' };
});

function renderRoutineMention(documentName: string) {
  render(() => (
    <DocumentMention
      key="node-1"
      documentId="routine-1"
      documentName={documentName}
      blockName="routine"
      theme={{}}
    />
  ));
}

it('names a pasted routine link, which has no saved label, from the routine', () => {
  mocks.preview = {
    loading: false,
    id: 'routine-1',
    type: 'routine',
    access: 'access',
    name: 'Daily CRM sweep',
  };
  renderRoutineMention('');
  expect(screen.getByRole('link', { name: 'Daily CRM sweep' })).toBeTruthy();
  expect(screen.queryByText('Loading...')).toBeNull();
});

it('never reads as loading forever while the routine has not been read', () => {
  renderRoutineMention('');
  expect(screen.getByRole('link', { name: 'Routine' })).toBeTruthy();
  expect(screen.queryByText('Loading...')).toBeNull();
});

it('keeps the saved label of a routine picked from the mention menu', () => {
  mocks.preview = {
    loading: false,
    id: 'routine-1',
    type: 'routine',
    access: 'access',
    name: 'Renamed since',
  };
  renderRoutineMention('Weekly digest');
  expect(screen.getByRole('link', { name: 'Weekly digest' })).toBeTruthy();
});
