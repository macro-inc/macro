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
    onRetryBranches: vi.fn(),
    onConnectGitHub: vi.fn(),
  };
  render(() => (
    <RepositoryPicker
      branch="main"
      repositories={[macro, infra]}
      repositoriesLoading={false}
      repositoriesError={false}
      recentRepositories={[]}
      branches={['main', 'develop', 'feature/home']}
      branchesLoading={false}
      branchesError={false}
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
  screen
    .getAllByRole('option')
    .map((option) => option.textContent?.replace(/\s+/g, ' ').trim());

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

  it('shows the branch only with a repository and picks a listed one', () => {
    expect(picker().onSelectBranch).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Branch' })).toBeNull();
    cleanup();

    const handlers = picker({
      repoUrl: infra.url,
      branch: 'develop',
      branches: ['main', 'develop', 'feature/home'],
    });
    const branch = screen.getByRole('button', { name: 'Branch' });
    expect(branch.textContent).toContain('develop');
    fireEvent.click(branch);
    expect(optionNames()).toEqual([
      'develop (default)',
      'main',
      'feature/home',
    ]);
    const selected = screen.getByRole('option', { name: /develop/ });
    expect(selected.querySelector('svg.ml-auto')).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: 'feature/home' }));
    expect(handlers.onSelectBranch).toHaveBeenCalledWith('feature/home');
  });

  it('filters branches as you type and offers an unlisted name', () => {
    const handlers = picker({
      repoUrl: infra.url,
      branch: 'develop',
      branches: ['main', 'develop', 'feature/home'],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Branch' }));
    const field = screen.getByRole('combobox', { name: 'Search branches' });
    fireEvent.input(field, { target: { value: 'HOME' } });
    expect(optionNames()).toEqual(['feature/home', 'Use HOME']);
    fireEvent.input(field, { target: { value: 'feature/other' } });
    expect(optionNames()).toEqual(['Use feature/other']);
    fireEvent.click(screen.getByRole('option', { name: 'Use feature/other' }));
    expect(handlers.onSelectBranch).toHaveBeenCalledWith('feature/other');
  });

  it('refuses to submit text that is not a branch name', () => {
    const handlers = picker({ repoUrl: infra.url, branch: 'develop' });
    fireEvent.click(screen.getByRole('button', { name: 'Branch' }));
    const field = screen.getByRole('combobox', { name: 'Search branches' });
    fireEvent.input(field, { target: { value: 'bad..name' } });
    fireEvent.submit(field.closest('form') as HTMLFormElement);
    expect(screen.getByRole('alert').textContent).toContain('valid branch');
    expect(handlers.onSelectBranch).not.toHaveBeenCalled();
  });

  it('shows the loading, failed, and empty branch listings', () => {
    picker({
      repoUrl: infra.url,
      branches: [],
      branchesLoading: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Branch' }));
    expect(screen.getByText('Loading branches…')).toBeTruthy();
    cleanup();

    const failed = picker({
      repoUrl: infra.url,
      branches: [],
      branchesError: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Branch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(failed.onRetryBranches).toHaveBeenCalledOnce();
    cleanup();

    picker({ repoUrl: infra.url, branches: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Branch' }));
    expect(screen.getByText(/No branches yet/)).toBeTruthy();
  });
});
