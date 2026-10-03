import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePreferencesProvider } from '../home-prefs';
import { HomeChatStart } from './HomeChatStart';

type ChildrenProps = { children?: JSX.Element };

const mocks = vi.hoisted(() => ({
  agentsEnabled: true,
  asideCollapsed: false,
  asideOverlay: false,
  attachFiles: vi.fn<(files: File[]) => void>(),
}));

vi.mock('@app/components/view-shell', () => ({
  useViewShell: () => ({
    aside: {
      isCollapsed: () => mocks.asideCollapsed,
      isOverlay: () => mocks.asideOverlay,
    },
  }),
  ViewShell: {
    TopBar: (props: ChildrenProps) => (
      <div data-testid="home-topbar">{props.children}</div>
    ),
  },
  ViewSidebar: {
    Title: (props: ChildrenProps) => <span>{props.children}</span>,
  },
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: mocks.agentsEnabled }),
}));
vi.mock('@core/constant/featureFlags', () => ({ enableChatV3Agents: {} }));
vi.mock('@core/component/AI/component/DragDrop', () => ({
  DragDropWrapper: (props: ChildrenProps & { class?: string }) => (
    <div data-testid="home-composer-frame" class={props.class}>
      {props.children}
    </div>
  ),
}));
vi.mock('@core/component/AI/context', () => ({
  ChatInputProvider: (props: ChildrenProps) => props.children,
}));
vi.mock('@core/util/upload', () => ({
  handleFileFolderDrop: (
    entries: FileSystemFileEntry[],
    _folders: FileSystemDirectoryEntry[],
    onFilesReady: (files: { file: File; isFolder: boolean }[]) => void
  ) => {
    const files: { file: File; isFolder: boolean }[] = [];
    for (const entry of entries) {
      entry.file((file) => files.push({ file, isFolder: false }));
    }
    onFilesReady(files);
  },
}));
vi.mock('../home-chat-input', () => ({
  HomeChatInput: (props: {
    registerAttachFiles?: (attach: (files: File[]) => void) => void;
  }) => {
    // The agent composer hands its attach function up like NewChatPage does.
    if (mocks.agentsEnabled) props.registerAttachFiles?.(mocks.attachFiles);
    return <div data-testid="home-chat-input" />;
  },
}));
vi.mock('../home-getting-started-link', () => ({
  HomeGettingStartedLink: () => <div data-testid="getting-started-link" />,
}));
vi.mock('./home-recommended-actions', () => ({
  HomeRecommendedActions: () => <div data-testid="home-suggestions" />,
}));

beforeEach(() => {
  mocks.agentsEnabled = true;
  mocks.asideCollapsed = false;
  mocks.asideOverlay = false;
  mocks.attachFiles.mockReset();
});
afterEach(cleanup);

function renderHome() {
  return render(() => (
    <HomePreferencesProvider userId={() => 'user-1'}>
      <HomeChatStart />
    </HomePreferencesProvider>
  ));
}

/** A drag carrying one file, shaped like the browser's DataTransfer. */
function fileTransfer(file: File) {
  return {
    types: ['Files'],
    files: [file],
    items: [
      {
        kind: 'file',
        type: file.type,
        webkitGetAsEntry: () => null,
        getAsFile: () => file,
      },
    ],
    getData: () => '',
  };
}

describe('Home pane file drops', () => {
  it('attaches files dropped anywhere on the pane to the agent composer', async () => {
    renderHome();
    const frame = document.querySelector('[data-home-agent-drop-frame]');
    if (!frame) throw new Error('agents Home did not render its drop frame');
    const file = new File(['png'], 'shot.png', { type: 'image/png' });
    const dataTransfer = fileTransfer(file);
    const pane = screen.getByTestId('home-suggestions');

    fireEvent.dragEnter(pane, { dataTransfer });
    expect(
      screen.getByText('Drop files to attach to your message')
    ).toBeTruthy();

    fireEvent.drop(pane, { dataTransfer });
    await Promise.resolve();
    expect(mocks.attachFiles).toHaveBeenCalledWith([file]);
    expect(
      screen.queryByText('Drop files to attach to your message')
    ).toBeNull();
  });

  it('keeps the legacy chat upload frame when agents are disabled', () => {
    mocks.agentsEnabled = false;
    renderHome();
    expect(screen.getByTestId('home-composer-frame')).toBeTruthy();
    expect(document.querySelector('[data-home-agent-drop-frame]')).toBeNull();
  });
});

describe('Home agent composer alignment', () => {
  it('matches the Agents new-conversation topbar and padding when the list is open', () => {
    renderHome();
    const grid = document.querySelector('[data-home-composer-align="agents"]');
    expect(grid).toBeTruthy();
    expect(grid?.className).toContain('pt-6');
    expect(grid?.className).toContain('pb-16');
    expect(
      document.querySelector('[data-home-composer-topbar-align]')
    ).toBeTruthy();
    expect(document.querySelector('[data-testid="home-topbar"]')).toBeNull();
  });

  it('uses the real Home topbar instead of a spacer when the list is collapsed', () => {
    mocks.asideCollapsed = true;
    renderHome();
    expect(document.querySelector('[data-testid="home-topbar"]')).toBeTruthy();
    expect(
      document.querySelector('[data-home-composer-topbar-align]')
    ).toBeNull();
    expect(
      document.querySelector('[data-home-composer-align="agents"]')
    ).toBeTruthy();
  });

  it('keeps the legacy 32px-above-center composer when agents are disabled', () => {
    mocks.agentsEnabled = false;
    renderHome();
    const grid = document.querySelector('[data-home-composer-align="legacy"]');
    expect(grid).toBeTruthy();
    expect(grid?.className).toContain('pb-16');
    expect(grid?.className).not.toContain('pt-6');
    expect(
      document.querySelector('[data-home-composer-topbar-align]')
    ).toBeNull();
    expect(screen.getByText('What should we get done in Macro?')).toBeTruthy();
  });
});
