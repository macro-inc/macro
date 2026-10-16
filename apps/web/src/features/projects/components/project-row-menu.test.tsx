import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectRow } from '../context/projects-context';
import type { ProjectAccess } from '../core/project';
import { ProjectMenuDropdown } from './project-row-menu';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@app/components/ui/components/Tooltip', () => ({
  Tooltip: (props: ParentProps) => props.children,
}));
vi.mock('@entity', () => ({
  InlineEntity: (props: { entity: { name: string } }) => props.entity.name,
}));

let animationStyle: HTMLStyleElement;
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  animationStyle = document.createElement('style');
  animationStyle.textContent = '* { animation-name: none !important; }';
  document.head.append(animationStyle);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  animationStyle.remove();
  vi.restoreAllMocks();
});

const project = (access: ProjectAccess): ProjectRow => ({
  project: { id: 'launch', name: 'Launch', updatedAt: '', access },
  properties: [],
});

function setup(row: ProjectRow) {
  const onDelete = vi.fn();
  render(() => (
    <ProjectMenuDropdown
      targets={() => [row]}
      canOpenInNewSplit
      onOpenInNewSplit={vi.fn()}
      onRename={vi.fn()}
      onSetOption={vi.fn()}
      onCopyLink={vi.fn()}
      onCopyId={vi.fn()}
      onShare={vi.fn()}
      onDelete={onDelete}
    />
  ));
  return { onDelete };
}

// jsdom has no PointerEvent, so a mouse press is a MouseEvent tagged as one.
function click(element: Element) {
  for (const type of ['pointerdown', 'pointerup']) {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    element.dispatchEvent(event);
  }
}

async function openMenu() {
  click(screen.getByRole('button', { name: 'Project actions' }));
  await screen.findByRole('menu');
}

const entries = () =>
  screen
    .getAllByRole('menuitem')
    .map((item) => item.firstChild?.textContent ?? '');

describe('project actions dropdown', () => {
  it('offers an owner every action the row menu has', async () => {
    setup(project('owner'));
    await openMenu();
    expect(entries()).toEqual([
      'Open in new split',
      'Rename',
      'Copy Link',
      'Copy ID',
      'Share',
      'Delete',
    ]);
  });

  it('deletes the project it was opened for', async () => {
    const { onDelete } = setup(project('owner'));
    await openMenu();
    click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() =>
      expect(onDelete).toHaveBeenCalledWith([
        {
          project: {
            id: 'launch',
            name: 'Launch',
            updatedAt: '',
            access: 'owner',
          },
          properties: [],
        },
      ])
    );
  });

  it('keeps view access to navigation and links', async () => {
    setup(project('view'));
    await openMenu();
    expect(entries()).toEqual([
      'Open in new split',
      'Copy Link',
      'Copy ID',
      'Share',
    ]);
  });
});
