/** @vitest-environment jsdom */

import { BookingLinkMentionNode } from '@macro-inc/lexical-core';
import {
  clearDecorators,
  setDecorator,
} from '@macro-inc/lexical-core/decoratorRegistry';
import { registerMacroDecoratorViews } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { afterEach, beforeAll, expect, test } from 'vitest';
import type { BookingLinkMentionUIProps } from '../component/decorator/BookingLinkMention';
import { theme } from '../theme';
import {
  createNativeBookingLinkMentionContext,
  createNativeBookingLinkMentionViews,
} from './native-booking-views';

beforeAll(initializeNativeSurfaceTests);
afterEach(clearDecorators);

const BOOKING_DOCUMENT = JSON.stringify({
  root: {
    type: 'root',
    version: 1,
    children: [
      {
        type: 'paragraph',
        version: 1,
        children: [
          { type: 'text', version: 1, text: 'Book ' },
          {
            type: 'booking-link-mention',
            version: 1,
            profileId: 'fixture-profile',
            slug: 'intro',
            label: 'Intro call',
            url: 'https://example.test/app/book/fixture-profile/intro',
          },
        ],
      },
    ],
  },
});

test('a stored booking-link mention opens in the native editor through its production view', () => {
  const received: BookingLinkMentionUIProps[] = [];
  setDecorator<BookingLinkMentionUIProps>(BookingLinkMentionNode, (props) => {
    received.push(props);
    return <span data-recorded-booking="true">{props.label}</span>;
  });
  const fixture = nativeSurface();
  const context = createNativeBookingLinkMentionContext(theme);
  try {
    registerMacroDecoratorViews(
      fixture.view.registry,
      createNativeBookingLinkMentionViews(context)
    );
    fixture.port.setState(BOOKING_DOCUMENT);
    expect(fixture.errors).toEqual([]);
    expect(fixture.root.textContent).toContain('Book');
    expect(
      fixture.root.querySelector('[data-recorded-booking]')?.textContent
    ).toBe('Intro call');
    expect(received.at(-1)).toMatchObject({
      profileId: 'fixture-profile',
      slug: 'intro',
      label: 'Intro call',
      url: 'https://example.test/app/book/fixture-profile/intro',
    });
  } finally {
    context.dispose();
    fixture.close();
  }
});

test('without the booking view the same document cannot open (the #15 failure)', () => {
  const fixture = nativeSurface();
  try {
    let failure: unknown;
    try {
      fixture.port.setState(BOOKING_DOCUMENT);
    } catch (error) {
      failure = error;
    }
    const reported = [failure, ...fixture.errors].filter(Boolean).map(String);
    expect(reported.join('\n')).toContain(
      'Missing node view: booking-link-mention'
    );
  } finally {
    fixture.close();
  }
});
