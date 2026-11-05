import { expect, test } from '@playwright/test';

test('invitation retains the selected voice through price review', async ({
  page,
}) => {
  await page.goto('/?voices');
  await page.getByRole('button', { name: 'Invite agent', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Assistant');
  await page.getByLabel('Job description').fill('Help with planning');
  await page.getByLabel('Personality').fill('Warm and direct');
  const picker = page.getByRole('combobox', { name: 'Voice', exact: true });
  await expect(picker).toHaveValue('Thalia');
  await page.getByRole('button', { name: 'Show voices' }).click();
  await page.getByRole('option', { name: /Arcas/ }).click();
  await page.getByRole('button', { name: 'Review price' }).click();
  await page.getByRole('button', { name: /Confirm/ }).click();
  await expect(page.getByText('Invited voice: aura-2-arcas-en')).toBeVisible();
});

test('voice settings stop samples on selection and keep a failed save retryable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const NativeAudio = Audio;
    window.Audio = class extends NativeAudio {
      constructor(_source?: string) {
        super();
      }
      async play() {}
      pause() {}
    };
  });
  await page.goto('/?voices&voice-save-error');
  await page.getByRole('button', { name: 'Change voice', exact: true }).click();
  await page.getByRole('button', { name: 'Play sample', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Stop sample', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Show voices' }).click();
  await page.getByRole('option', { name: /Thalia/ }).click();
  await expect(
    page.getByRole('button', { name: 'Play sample', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save voice', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText("Couldn't save");
  await expect(
    page.getByRole('combobox', { name: 'Voice', exact: true })
  ).toHaveValue('Thalia');
  await page.getByRole('button', { name: 'Save voice', exact: true }).click();
  await expect(page.getByText('Saved voice: aura-2-thalia-en')).toBeVisible();
  await page.getByRole('button', { name: 'Change voice', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'Voice', exact: true })
  ).toHaveValue('Thalia');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
});
