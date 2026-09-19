/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionLine } from './ActionLine';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ActionLine', () => {
  it('keeps a quiet action as a truncated rule', () => {
    render(() => <ActionLine label="Model set to claude-opus-5" />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Model set to claude-opus-5').className).toContain(
      'truncate'
    );
  });

  it('wraps a failed action instead of cutting the error off', () => {
    const message =
      'Internal error: Bad Request: bad request: Authorization header is badly formatted';
    render(() => (
      <ActionLine label="The agent couldn't answer" detail={message} failed />
    ));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain("The agent couldn't answer");
    expect(alert.textContent).toContain(message);
    expect(screen.queryByText(message)?.className).toContain(
      'whitespace-pre-wrap'
    );
    expect(screen.queryByText(message)?.className).not.toContain('truncate');
  });

  it('copies the runtime message', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(() => (
      <ActionLine
        label="The agent couldn't answer"
        detail="no credentials"
        failed
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Copy error' }));
    expect(writeText).toHaveBeenCalledWith('no credentials');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });
});
