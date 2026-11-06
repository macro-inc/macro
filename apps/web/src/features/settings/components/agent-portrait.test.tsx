import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentPortrait } from './agent-portrait';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('debounces the first portrait, uses current profile and never regenerates for draft edits', async () => {
  vi.useFakeTimers();
  const generate = vi
    .fn()
    .mockResolvedValue('https://static.example/portrait.png');
  const [name, setName] = createSignal('');
  const [role, setRole] = createSignal('Engineer');
  const [avatar, setAvatar] = createSignal('');
  render(() => (
    <AgentPortrait
      name={name()}
      role={role()}
      personality="Calm"
      avatar={avatar()}
      onChange={setAvatar}
      onPendingChange={() => {}}
      source={{ generate, upload: vi.fn() }}
    />
  ));
  setName('A');
  await vi.advanceTimersByTimeAsync(700);
  setName('Assistant');
  await vi.advanceTimersByTimeAsync(700);
  expect(generate).not.toHaveBeenCalled();
  setRole('Designer');
  await vi.advanceTimersByTimeAsync(300);
  expect(generate).toHaveBeenCalledExactlyOnceWith({
    name: 'Assistant',
    role: 'Designer',
    personality: 'Calm',
  });
  expect(
    screen.getByRole('img', { name: 'Agent portrait' }).getAttribute('src')
  ).toBe('https://static.example/portrait.png');
  setName('New name');
  await vi.advanceTimersByTimeAsync(1200);
  expect(generate).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Generate another' }));
  await Promise.resolve();
  expect(generate).toHaveBeenCalledTimes(2);
  expect(generate).toHaveBeenLastCalledWith({
    name: 'New name',
    role: 'Designer',
    personality: 'Calm',
  });
});

it('keeps an uploaded photo and ignores a generated result for an old name', async () => {
  vi.useFakeTimers();
  let finish: (url: string) => void = () => {};
  const generate = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      })
  );
  const [name, setName] = createSignal('Assistant');
  const [avatar, setAvatar] = createSignal('');
  const upload = vi.fn().mockResolvedValue('https://static.example/upload.png');
  render(() => (
    <AgentPortrait
      name={name()}
      role="Engineer"
      personality="Calm"
      avatar={avatar()}
      onChange={setAvatar}
      onPendingChange={() => {}}
      source={{ generate, upload }}
    />
  ));
  await vi.advanceTimersByTimeAsync(1000);
  setName('Different');
  finish('https://static.example/old.png');
  await Promise.resolve();
  await Promise.resolve();
  expect(screen.queryByRole('img')).toBeNull();
  const file = new File(['image'], 'photo.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('Upload agent photo'), {
    target: { files: [file] },
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(upload).toHaveBeenCalledWith(file);
  expect(screen.getByRole('img').getAttribute('src')).toBe(
    'https://static.example/upload.png'
  );
  setName('Final');
  await vi.advanceTimersByTimeAsync(1200);
  expect(generate).toHaveBeenCalledTimes(1);
});

it('cancels the scheduled request after a manual generation or upload', async () => {
  vi.useFakeTimers();
  const generate = vi
    .fn()
    .mockResolvedValue('https://static.example/generated.png');
  const upload = vi.fn().mockResolvedValue('https://static.example/upload.png');
  const [name, setName] = createSignal('Assistant');
  const [avatar, setAvatar] = createSignal('');
  render(() => (
    <AgentPortrait
      name={name()}
      role="Engineer"
      personality="Calm"
      avatar={avatar()}
      onChange={setAvatar}
      onPendingChange={() => {}}
      source={{ generate, upload }}
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Generate another' }));
  await vi.advanceTimersByTimeAsync(1200);
  expect(generate).toHaveBeenCalledTimes(1);
  cleanup();
  setName('New assistant');
  setAvatar('');
  render(() => (
    <AgentPortrait
      name={name()}
      role="Engineer"
      personality="Calm"
      avatar={avatar()}
      onChange={setAvatar}
      onPendingChange={() => {}}
      source={{ generate, upload }}
    />
  ));
  fireEvent.change(screen.getByLabelText('Upload agent photo'), {
    target: {
      files: [new File(['image'], 'photo.png', { type: 'image/png' })],
    },
  });
  await vi.advanceTimersByTimeAsync(1200);
  expect(upload).toHaveBeenCalledTimes(1);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('img').getAttribute('src')).toBe(
    'https://static.example/upload.png'
  );
});
