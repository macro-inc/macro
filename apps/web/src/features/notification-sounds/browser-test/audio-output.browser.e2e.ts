import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    soundAudioContexts: AudioContext[];
    soundAnalysers: AnalyserNode[];
    sampleSoundPeak: () => number;
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.soundAudioContexts = [];
    window.soundAnalysers = [];
    const BrowserAudioContext = window.AudioContext;
    window.AudioContext = class extends BrowserAudioContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        window.soundAudioContexts.push(this);
      }

      createGain() {
        const gain = super.createGain();
        const analyser = this.createAnalyser();
        gain.connect(analyser);
        window.soundAnalysers.push(analyser);
        return gain;
      }
    };
    // Read real rendered PCM, not just oscillator scheduling calls.
    let peak = 0;
    const measure = () => {
      for (const analyser of window.soundAnalysers) {
        const samples = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(samples);
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      }
      requestAnimationFrame(measure);
    };
    requestAnimationFrame(measure);
    window.sampleSoundPeak = () => peak;
  });
  await page.goto('/');
});

test('keyboard-only activation unlocks a later call cue with notification sounds off', async ({
  page,
}) => {
  await expect(
    page.getByRole('switch', { name: 'Notification sounds', exact: true })
  ).not.toBeChecked();
  await page.getByRole('heading', { name: 'Notifications' }).focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.soundAudioContexts.every(
            (context) => context.state === 'running'
          ) && window.soundAudioContexts.length > 0
      )
    )
    .toBe(true);
  // Delivery occurs outside the keyboard handler, as a real join event does.
  await page.evaluate(() => window.playCallCue('join'));
  await expect
    .poll(() => page.evaluate(() => window.sampleSoundPeak()))
    .toBeGreaterThan(0.01);
});

test('the gesture enabling sounds unlocks audio before the setting changes', async ({
  page,
}) => {
  await page.evaluate(() =>
    localStorage.setItem(
      'macro:notification-sounds:fixture-user',
      JSON.stringify({ enabled: false, callSoundsEnabled: false })
    )
  );
  await page.reload();
  const toggle = page.getByRole('switch', { name: 'Call sounds', exact: true });
  await expect(toggle).not.toBeChecked();
  await toggle.focus();
  await toggle.press('Space');
  await expect(toggle).toBeChecked();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.soundAudioContexts.some((context) => context.state === 'running')
      )
    )
    .toBe(true);
  await page.evaluate(() => window.playCallCue('leave'));
  await expect
    .poll(() => page.evaluate(() => window.sampleSoundPeak()))
    .toBeGreaterThan(0.01);
});
