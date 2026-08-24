/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { OnboardingHardModeProvider } from './HardMode';
import { SkipButton } from './shared';

describe('onboarding hard mode', () => {
  it('shows an always-on Hard mode switch', () => {
    render(() => (
      <div class="relative h-96 w-96">
        <OnboardingHardModeProvider>
          <SkipButton onClick={() => undefined} />
        </OnboardingHardModeProvider>
      </div>
    ));

    expect(screen.getByText('Hard mode')).toBeTruthy();
    expect(screen.getByRole('switch')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeTruthy();
  });

  it('moves skip out of document flow when hard mode is on', () => {
    render(() => (
      <div class="relative h-96 w-96">
        <OnboardingHardModeProvider>
          <SkipButton onClick={() => undefined} />
        </OnboardingHardModeProvider>
      </div>
    ));

    fireEvent.click(screen.getByRole('switch'));
    const skip = screen.getByRole('button', { name: 'Skip for now' });
    expect(skip.parentElement?.className).toContain('absolute');
  });
});
