import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReachableRepository } from '../core/repository';
import { RepositoryPicker } from './RepositoryPicker';

const macro: ReachableRepository = {
  url: 'https://github.com/macro-inc/macro',
  defaultBranch: 'main',
};
const infra: ReachableRepository = {
  url: 'https://github.com/macro-inc/infra',
  defaultBranch: 'develop',
};

function picker(
  overrides: Partial<Parameters<typeof RepositoryPicker>[0]> = {}
) {
  const handlers = {
    onSelectRepository: vi.fn(),
    onSelectBranch: vi.fn(),
    onRetryRepositories: vi.fn(),
    onConnectGitHub: vi.fn(),
  };
  render(() => (
    <RepositoryPicker
      branch="main"
      repositories={[macro, infra]}
      repositoriesLoading={false}
      repositoriesError={false}
      recentRepositories={[]}
      {...handlers}
      {...overrides}
    />
  ));
  return handlers;
}
const openRepositories = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Repository' }));
const search = () =>
  screen.getByRole('combobox', { name: 'Search repositories' });
const optionNames = () =>
  screen.getAllByRole('option').map((option) => option.textContent?.trim());

describe('RepositoryPicker', () => {
  beforeEach(() => vi.stubGlobal('scrollTo', vi.fn()));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists automatic first, then recents, then the rest, marking the selection', () => {
    picker({ repoUrl: infra.url, recentRepositories: [infra.url] });
    expect(
      screen.getByRole('button', { name: 'Repository' }).textContent
    ).toContain('macro-inc/infra');
    openRepositories();
    expect(optionNames()).toEqual([
      'Choose automatically',
      'macro-inc/infra',
      'macro-inc/macro',
    ]);
    const selected = screen.getByRole('option', { name: 'macro-inc/infra' });
    expect(selected.querySelector('svg.ml-auto')).toBeTruthy();
    expect(
      screen
        .getByRole('option', { name: 'macro-inc/macro' })
        .querySelector('svg.ml-auto')
    ).toBeNull();
  });

  it('filters as you type and picks the highlighted match on Enter', () => {
    const handlers = picker();
    openRepositories();
    fireEvent.input(search(), { target: { value: 'INFRA' } });
    expect(optionNames()).toEqual(['macro-inc/infra']);
    fireEvent.submit(search().closest('form') as HTMLFormElement);
    expect(handlers.onSelectRepository).toHaveBeenCalledWith(infra.url);
  });

  it('moves the highlight with the arrow keys', () => {
    const handlers = picker();
    openRepositories();
    expect(
      screen
        .getByRole('option', { name: 'Choose automatically' })
        .getAttribute('aria-selected')
    ).toBe('true');
    fireEvent.keyDown(search(), { key: 'ArrowDown' });
    fireEvent.keyDown(search(), { key: 'ArrowDown' });
    expect(
      screen
        .getByRole('option', { name: 'macro-inc/infra' })
        .getAttribute('aria-selected')
    ).toBe('true');
    fireEvent.keyDown(search(), { key: 'ArrowUp' });
    fireEvent.submit(search().closest('form') as HTMLFormElement);
    expect(handlers.onSelectRepository).toHaveBeenCalledWith(macro.url);
  });

  it('does not offer an unlisted repository typed by hand', () => {
    const handlers = picker();
    openRepositories();
    fireEvent.input(search(), {
      target: { value: 'https://github.com/macro-inc/other.git' },
    });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(/No repositories match/).textContent).toContain(
      'macro-inc/other'
    );
    expect(handlers.onSelectRepository).not.toHaveBeenCalled();
  });

  it('does not offer a recent the listing no longer carries', () => {
    picker({
      recentRepositories: ['https://github.com/macro-inc/gone'],
    });
    openRepositories();
    expect(optionNames()).toEqual([
      'Choose automatically',
      'macro-inc/macro',
      'macro-inc/infra',
    ]);
    expect(screen.queryByRole('option', { name: /gone/ })).toBeNull();
  });

  it('does not duplicate a listed repository typed in full', () => {
    picker();
    openRepositories();
    fireEvent.input(search(), { target: { value: 'macro-inc/macro' } });
    expect(optionNames()).toEqual(['macro-inc/macro']);
  });

  it('explains when nothing matches and refuses to submit text that names no repository', () => {
    const handlers = picker();
    openRepositories();
    fireEvent.input(search(), { target: { value: 'nothing here' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(/No repositories match/).textContent).toContain(
      'nothing here'
    );
    fireEvent.submit(search().closest('form') as HTMLFormElement);
    expect(screen.getByRole('alert').textContent).toContain('owner/repo');
    expect(handlers.onSelectRepository).not.toHaveBeenCalled();
  });

  it('leaves the choice to the coder with Choose automatically', () => {
    const handlers = picker({ repoUrl: macro.url });
    openRepositories();
    fireEvent.click(
      screen.getByRole('option', { name: 'Choose automatically' })
    );
    expect(handlers.onSelectRepository).toHaveBeenCalledWith(undefined);
  });

  it('shows the loading, failed, and empty listings', () => {
    const handlers = picker({ repositories: [], repositoriesLoading: true });
    openRepositories();
    expect(screen.getByText('Loading your repositories…')).toBeTruthy();
    cleanup();

    const failed = picker({ repositories: [], repositoriesError: true });
    openRepositories();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(failed.onRetryRepositories).toHaveBeenCalledOnce();
    cleanup();

    const empty = picker({ repositories: [] });
    openRepositories();
    expect(screen.getByText(/No repositories yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    expect(empty.onConnectGitHub).toHaveBeenCalledOnce();
    expect(handlers.onSelectRepository).not.toHaveBeenCalled();
  });

  it('shows the branch only with a repository and validates the one typed', () => {
    expect(picker().onSelectBranch).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Branch' })).toBeNull();
    cleanup();

    const handlers = picker({ repoUrl: infra.url, branch: 'develop' });
    const branch = screen.getByRole('button', { name: 'Branch' });
    expect(branch.textContent).toContain('develop');
    fireEvent.click(branch);
    const field = screen.getByRole('textbox', { name: 'Starting branch' });
    expect((field as HTMLInputElement).value).toBe('develop');
    fireEvent.input(field, { target: { value: 'bad..name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use branch' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(handlers.onSelectBranch).not.toHaveBeenCalled();
    fireEvent.input(field, { target: { value: 'feature/home' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use branch' }));
    expect(handlers.onSelectBranch).toHaveBeenCalledWith('feature/home');
  });
});
