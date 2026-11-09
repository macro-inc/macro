/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@solidjs/testing-library';
import { beforeAll, expect, it, vi } from 'vitest';
import { ReleaseComputerDialog } from './release-computer-dialog';

beforeAll(() => {
  vi.stubGlobal('scrollTo', vi.fn());
});

it('releases only once the exact computer name is typed', () => {
  const onRelease = vi.fn();
  render(() => (
    <ReleaseComputerDialog
      computerName="Build machine"
      pending={false}
      onClose={vi.fn()}
      onRelease={onRelease}
    />
  ));

  const release = screen.getByRole('button', { name: 'Release now' });
  const input = screen.getByPlaceholderText('Build machine');
  expect(release).toHaveProperty('disabled', true);

  fireEvent.input(input, { target: { value: 'build machine' } });
  expect(release).toHaveProperty('disabled', true);
  fireEvent.click(release);
  expect(onRelease).not.toHaveBeenCalled();

  fireEvent.input(input, { target: { value: 'Build machine' } });
  expect(release).toHaveProperty('disabled', false);
  fireEvent.click(release);
  expect(onRelease).toHaveBeenCalledTimes(1);
});
