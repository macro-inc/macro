import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { watchCompiledSourceDeps } from '../contact-browser-test/compiled-source-deps';
import type {} from './fixture';

const PATH =
  '/src/lib/core/component/LexicalMarkdown/decorator-host/booking-browser-test/fixture.html';
const CASES = [
  { name: 'label', label: 'Saved label', writes: 0 },
  { name: 'slug', label: 'supplied-slug', writes: 1 },
  { name: 'url', label: 'url-slug', writes: 1 },
  { name: 'generic', label: 'Booking link', writes: 1 },
  { name: 'blank', label: ' ', writes: 0 },
  { name: 'empty', label: 'url-slug', writes: 1 },
  { name: 'null', label: 'url-slug', writes: 1 },
];
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function withNullOptionalFields(input: string) {
  const parsed: unknown = JSON.parse(input);
  if (
    !record(parsed) ||
    !record(parsed.root) ||
    !Array.isArray(parsed.root.children)
  )
    throw new Error('Invalid Source seed');
  const paragraph: unknown = parsed.root.children[0];
  if (!record(paragraph) || !Array.isArray(paragraph.children))
    throw new Error('Invalid Source paragraph');
  const booking: unknown = paragraph.children[1];
  if (!record(booking) || booking.type !== 'booking-link-mention')
    throw new Error('Missing Source booking seed');
  booking.label = null;
  booking.slug = null;
  return JSON.stringify(parsed);
}

test.beforeAll(async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.route('**/__macro_dev/gateway/**', (route) =>
    route.fulfill({ json: { links: [] } })
  );
  try {
    await page.goto(`${PATH}?engine=factory`);
    await expect
      .poll(() => page.evaluate(() => !!window.bookingProof))
      .toBe(true);
  } finally {
    try {
      await page.evaluate(() => window.bookingProofClose?.());
    } finally {
      await context.close();
    }
  }
});

for (const variant of CASES) {
  test(`actual Source booking ${variant.name} raw render, label update, hover and external opening`, async ({
    context,
  }, info) => {
    const factory = await context.newPage();
    const page = await context.newPage();
    const witnesses = [factory, page].map(watchCompiledSourceDeps);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const stages = [];
    await context.route('**/__macro_dev/gateway/**', (route) =>
      route.fulfill({ json: { links: [] } })
    );
    await context.route(/^https:\/\/(?:macro\.com|example\.test)\//, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Booking boundary</title>',
      })
    );
    try {
      await factory.goto(`${PATH}?engine=factory&case=${variant.name}`);
      await expect
        .poll(() => factory.evaluate(() => !!window.bookingProof))
        .toBe(true);
      const produced = await factory.evaluate(
        () => window.bookingProof?.capture().model
      );
      if (!produced) throw new Error('Missing Source factory model');
      const input =
        variant.name === 'null' ? withNullOptionalFields(produced) : produced;
      await page.addInitScript((input) => {
        window.bookingProofInput = input;
      }, input);
      await page.goto(`${PATH}?engine=source&case=${variant.name}`);
      await expect
        .poll(() => page.evaluate(() => !!window.bookingProof))
        .toBe(true);
      const content = page.locator('[data-booking-label]');
      await expect(content).toHaveAttribute(
        'data-booking-label',
        variant.label
      );
      await expect
        .poll(() =>
          page.evaluate(() =>
            window.bookingProof?.capture().model.includes('"label":')
          )
        )
        .toBe(true);
      const mounted = await page.evaluate(() => window.bookingProof?.capture());
      if (!mounted) throw new Error('Missing Source mounted capture');
      expect(
        mounted.tags.filter((tags) => tags.includes('historic'))
      ).toHaveLength(variant.writes);
      if (variant.writes)
        expect(
          mounted.tags.filter((tags) => tags.includes('historic'))
        ).toEqual([
          ['historic', 'skip-dom-selection', 'skip-scroll-into-view'],
        ]);
      expect(mounted.model).toContain(
        `"label":${JSON.stringify(variant.label)}`
      );
      if (variant.name === 'null')
        expect(mounted.model).toContain('"slug":null');
      stages.push(mounted);
      await content.hover();
      await expect(page.locator('a[target="_blank"]')).toBeVisible();
      stages.push(await page.evaluate(() => window.bookingProof?.capture()));
      await page.mouse.move(950, 750);
      await expect(page.locator('a[target="_blank"]')).toHaveCount(0);
      await page.evaluate(() => window.bookingProof?.select());
      await expect(content.locator('..')).toHaveClass(/bg-active/);
      stages.push(await page.evaluate(() => window.bookingProof?.capture()));
      const popup = context.waitForEvent('page');
      const handled = await page.evaluate(() => window.bookingProof?.enter());
      expect(handled).toBe(true);
      const opened = await popup;
      try {
        await expect(opened).toHaveTitle('Booking boundary');
      } finally {
        await opened.close();
      }
      expect(errors).toEqual([]);
      if (process.env.BOOKING_SOURCE_CAPTURE)
        writeFileSync(
          `${process.env.BOOKING_SOURCE_CAPTURE}/${info.project.name}-${variant.name}.json`,
          JSON.stringify({ input, stages, handled })
        );
    } finally {
      try {
        const compiled = await Promise.allSettled(
          witnesses.map((finish) => finish())
        );
        await info.attach('source-booking.json', {
          contentType: 'application/json',
          body: JSON.stringify({ stages, errors, compiled }),
        });
        expect(compiled.map((result) => result.status)).toEqual([
          'fulfilled',
          'fulfilled',
        ]);
      } finally {
        try {
          await Promise.all([
            factory.evaluate(() => window.bookingProofClose?.()),
            page.evaluate(() => window.bookingProofClose?.()),
          ]);
        } finally {
          await Promise.all([factory.close(), page.close()]);
        }
      }
    }
  });
}
