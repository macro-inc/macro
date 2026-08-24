/**
 * @vitest-environment jsdom
 *
 * A control's outcome is what the line has to get right: a refused model
 * switch that reads like a successful one is the bug this component exists
 * to prevent.
 */

import type { MessagePart } from '@service-agent-fold/generated/types';
import { render } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { ControlPart } from './ControlPart';

// The `ui` barrel reaches the chat input's storage module on import; the
// layer under test is the outcome vocabulary, so the line itself is a stub
// (the `ToolCallPart.test.tsx` idiom).
vi.mock('../../ui', () => ({
  ActionLine: (props: { label: string; failed?: boolean; detail?: string }) => (
    <div
      data-testid="action-line"
      data-failed={String(props.failed ?? false)}
      title={props.detail}
    >
      {props.label}
    </div>
  ),
}));

type Control = Extract<MessagePart, { kind: 'control' }>;

const setModel = (outcome: Control['outcome']): Control => ({
  kind: 'control',
  control: { kind: 'set_model', model: 'openai/gpt-5' },
  outcome,
});

const lineOf = (part: Control) => {
  const { container } = render(() => <ControlPart part={part} />);
  return container.textContent ?? '';
};

const failedOf = (part: Control) => {
  const { getByTestId } = render(() => <ControlPart part={part} />);
  return getByTestId('action-line').getAttribute('data-failed');
};

describe('a model change', () => {
  it('reads as done only once it is accepted', () => {
    expect(lineOf(setModel({ kind: 'pending' }))).toContain(
      'Setting model to openai/gpt-5'
    );
    expect(lineOf(setModel({ kind: 'accepted' }))).toBe(
      'Model set to openai/gpt-5'
    );
  });

  it('says it did not happen when the runtime refuses', () => {
    const part = setModel({ kind: 'rejected', message: 'unknown model' });
    expect(lineOf(part)).toContain("Couldn't switch to openai/gpt-5");
    expect(lineOf(part)).not.toContain('Model set to');
    expect(failedOf(part)).toBe('true');
    expect(failedOf(setModel({ kind: 'accepted' }))).toBe('false');
  });

  it('carries the runtime message verbatim, on hover', () => {
    const { getByTitle } = render(() => (
      <ControlPart
        part={setModel({ kind: 'rejected', message: 'no credentials' })}
      />
    ));
    expect(getByTitle('no credentials')).toBeTruthy();
  });
});

describe('the other controls', () => {
  it('name their own failure', () => {
    expect(
      lineOf({
        kind: 'control',
        control: { kind: 'compact' },
        outcome: { kind: 'rejected', message: 'nope' },
      })
    ).toContain("Couldn't compact the context");
  });

  // Nothing answers a stop, so the fold accepts it the moment it is issued.
  it('reads a stop as done whether or not anything answered', () => {
    const stop = (outcome: Control['outcome']): Control => ({
      kind: 'control',
      control: { kind: 'stop' },
      outcome,
    });
    expect(lineOf(stop({ kind: 'pending' }))).toBe('Stopped');
    expect(lineOf(stop({ kind: 'accepted' }))).toBe('Stopped');
  });
});
