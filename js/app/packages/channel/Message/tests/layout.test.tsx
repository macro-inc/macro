/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { Root } from '../Root';
import { Layout } from '../Layout';
import { Slot } from '../Slot';
import type { MessageData } from '../types';

const baseMessage: MessageData = {
  id: 'message-1',
  content: 'hello',
  sender_id: 'user-1',
  created_at: '2026-02-25T00:00:00.000Z',
  updated_at: '2026-02-25T00:00:00.000Z',
  attachments: [],
  reactions: [],
};

describe('Message.Layout', () => {
  it('assigns semantic slot placements independent of child order', () => {
    const { container } = render(() => (
      <Root message={baseMessage}>
        <Layout>
          <Slot placement="body">
            <div>body</div>
          </Slot>
          <Slot placement="actions">
            <div>actions</div>
          </Slot>
          <Slot placement="icon">
            <div>icon</div>
          </Slot>
          <Slot placement="header">
            <div>header</div>
          </Slot>
        </Layout>
      </Root>
    ));

    expect(container.querySelector('[data-message-layout]')).toBeTruthy();
    expect(
      container.querySelector('[data-message-slot="icon"]')?.getAttribute('style')
    ).toContain('grid-area: icon');
    expect(
      container.querySelector('[data-message-slot="header"]')?.getAttribute(
        'style'
      )
    ).toContain('grid-area: header');
    expect(
      container.querySelector('[data-message-slot="body"]')?.getAttribute('style')
    ).toContain('grid-area: body');
    expect(
      container.querySelector('[data-message-slot="actions"]')?.getAttribute(
        'style'
      )
    ).toContain('grid-area: actions');
    expect(screen.getByText('icon')).toBeTruthy();
    expect(screen.getByText('header')).toBeTruthy();
    expect(screen.getByText('body')).toBeTruthy();
    expect(screen.getByText('actions')).toBeTruthy();
  });

  it('marks editing layouts for editor-specific spacing', () => {
    const { container } = render(() => (
      <Root message={baseMessage}>
        <Layout editing>
          <Slot placement="body">
            <div>body</div>
          </Slot>
        </Layout>
      </Root>
    ));

    expect(container.querySelector('[data-message-layout]')).toBeTruthy();
    expect(container.querySelector('.\\[\\&_\\[data-message-slot\\=body\\]\\]\\:mt-2')).toBeTruthy();
  });
});
