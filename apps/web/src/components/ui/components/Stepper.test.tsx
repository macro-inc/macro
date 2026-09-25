import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { Stepper } from './Stepper';

afterEach(cleanup);

describe('Stepper', () => {
  it('finishes an outin step change while detached by an ancestor Suspense', async () => {
    const [step, setStep] = createSignal(0);
    const { container } = render(() => (
      <Stepper step={step()} transition={Stepper.transitions.scale}>
        <Stepper.Step>
          <p>Step one</p>
        </Stepper.Step>
        <Stepper.Step>
          <p>Step two</p>
        </Stepper.Step>
      </Stepper>
    ));
    expect(screen.getByText('Step one')).toBeTruthy();

    // A suspending ancestor pulls its subtree out of the document, where CSS
    // transitions never run and so never emit transitionend.
    const host = container.parentNode as ParentNode;
    container.remove();
    setStep(1);

    await waitFor(() => {
      expect(container.textContent).toContain('Step two');
      expect(container.textContent).not.toContain('Step one');
    });

    host.appendChild(container);
    const slot = screen.getByText('Step two').parentElement as HTMLElement;
    await waitFor(() => {
      expect(slot.className).not.toMatch(/opacity-0|transition-all/);
    });
  });
});
