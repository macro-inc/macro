/**
 * @vitest-environment jsdom
 */

import { render } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { EditorSystemMessage } from './EditorSystemMessage';

describe('EditorSystemMessage', () => {
  it('renders the base variant by default', () => {
    const { getByRole } = render(() => (
      <EditorSystemMessage>Document status</EditorSystemMessage>
    ));

    const message = getByRole('status');
    expect(message.dataset.variant).toBe('base');
    expect(message.classList.contains('rounded-lg')).toBe(true);
    expect(message.classList.contains('p-3')).toBe(true);
  });

  it('renders errors as alerts with a line-height-aligned icon', () => {
    const { getByRole } = render(() => (
      <EditorSystemMessage variant="error">Document error</EditorSystemMessage>
    ));

    const message = getByRole('alert');
    expect(message.dataset.variant).toBe('error');
    expect(message.classList.contains('items-start')).toBe(true);
    expect(message.querySelector('[aria-hidden="true"]')?.classList).toContain(
      'h-lh'
    );
  });

  it('renders warnings as statuses', () => {
    const { getByRole } = render(() => (
      <EditorSystemMessage variant="warning">
        Document warning
      </EditorSystemMessage>
    ));

    expect(getByRole('status').dataset.variant).toBe('warning');
  });
});
