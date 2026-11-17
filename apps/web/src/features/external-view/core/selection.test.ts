import type { ExternalChatProvider } from '@service-storage/generated/schemas/externalChatProvider';
import { expect, it } from 'vitest';
import { selectedProvider } from './selection';

// A second provider stands in for one this branch doesn't define yet.
const OTHER = 'other' as ExternalChatProvider;

it('shows the provider the latest navigation named, while its flag is on', () => {
  const enabled: ExternalChatProvider[] = ['whatsapp', OTHER];
  expect(selectedProvider(undefined, enabled)).toBe('whatsapp');
  // A sidebar click on WhatsApp, then a Connect that names the other one.
  expect(selectedProvider('whatsapp', enabled)).toBe('whatsapp');
  expect(selectedProvider(OTHER, enabled)).toBe(OTHER);
  // A provider whose flag is off falls back to the first enabled one.
  expect(selectedProvider(OTHER, ['whatsapp'])).toBe('whatsapp');
  expect(selectedProvider(undefined, [])).toBeUndefined();
});
