/** @vitest-environment jsdom */

import { ContactMentionNode } from '@macro-inc/lexical-core';
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
import type { ContactMentionUIProps } from '../component/decorator/ContactMention';
import { theme } from '../theme';
import { createNativeFastContactDecoratorViews } from './fast-contact-views';
import { createNativeContactContext } from './native-contact-host';

beforeAll(initializeNativeSurfaceTests);
afterEach(clearDecorators);

/**
 * Mounts stored contacts beside a sibling paragraph through the real registry,
 * with a recording component in place of ContactMention: this guards the
 * projector and registry mount, not the component's own rendering.
 */
function mount(contacts: readonly object[]) {
  const received: ContactMentionUIProps[] = [];
  setDecorator<ContactMentionUIProps>(ContactMentionNode, (props) => {
    received.push(props);
    return <span data-recorded-contact="true" />;
  });
  const fixture = nativeSurface();
  const context = createNativeContactContext(theme);
  registerMacroDecoratorViews(
    fixture.view.registry,
    createNativeFastContactDecoratorViews(context)
  );
  const close = () => {
    context.dispose();
    fixture.close();
  };
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: contacts.map((contact) => ({
                type: 'contact-mention',
                version: 1,
                ...contact,
              })),
            },
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'sibling stays' }],
            },
          ],
        },
      })
    );
  } catch (error) {
    // An expected refusal must not leak the constructed session and root.
    close();
    throw error;
  }
  return { fixture, received, close };
}

test('projector hands stored null or missing contact fields to the registered component unchanged', () => {
  const mounted = mount([
    {
      contactId: 'valid-contact',
      name: 'Valid Person',
      emailOrDomain: 'valid@example.com',
      isCompany: false,
      mentionUuid: 'valid-mention',
    },
    {
      contactId: null,
      name: 'Null Id',
      emailOrDomain: 'null-id@example.com',
      isCompany: false,
      mentionUuid: null,
    },
    {
      name: 'Missing Id',
      emailOrDomain: 'missing@example.com',
      isCompany: false,
    },
    {
      contactId: 'null-email',
      name: 'Null Email',
      emailOrDomain: null,
      isCompany: false,
    },
    {
      contactId: 'missing-company-flag',
      name: 'Missing Flag',
      emailOrDomain: 'flag@example.com',
    },
    {
      contactId: 'null-company-name',
      name: null,
      emailOrDomain: 'example.com',
      isCompany: true,
    },
    {
      contactId: 'empty-name',
      name: '',
      emailOrDomain: 'empty@example.com',
      isCompany: false,
    },
    { contactId: 'missing-email', name: 'Missing Email', isCompany: false },
    {
      contactId: 'null-flag',
      name: 'Null Flag',
      emailOrDomain: 'null-flag@example.com',
      isCompany: null,
    },
  ]);
  try {
    expect(
      mounted.received.map(
        ({ contactId, name, emailOrDomain, isCompany, mentionUuid }) => ({
          contactId,
          name,
          emailOrDomain,
          isCompany,
          mentionUuid,
        })
      )
    ).toEqual([
      {
        contactId: 'valid-contact',
        name: 'Valid Person',
        emailOrDomain: 'valid@example.com',
        isCompany: false,
        mentionUuid: 'valid-mention',
      },
      {
        contactId: null,
        name: 'Null Id',
        emailOrDomain: 'null-id@example.com',
        isCompany: false,
        mentionUuid: null,
      },
      {
        contactId: undefined,
        name: 'Missing Id',
        emailOrDomain: 'missing@example.com',
        isCompany: false,
        mentionUuid: undefined,
      },
      {
        contactId: 'null-email',
        name: 'Null Email',
        emailOrDomain: null,
        isCompany: false,
        mentionUuid: undefined,
      },
      {
        contactId: 'missing-company-flag',
        name: 'Missing Flag',
        emailOrDomain: 'flag@example.com',
        isCompany: undefined,
        mentionUuid: undefined,
      },
      {
        contactId: 'null-company-name',
        name: null,
        emailOrDomain: 'example.com',
        isCompany: true,
        mentionUuid: undefined,
      },
      {
        contactId: 'empty-name',
        name: '',
        emailOrDomain: 'empty@example.com',
        isCompany: false,
        mentionUuid: undefined,
      },
      {
        contactId: 'missing-email',
        name: 'Missing Email',
        emailOrDomain: undefined,
        isCompany: false,
        mentionUuid: undefined,
      },
      {
        contactId: 'null-flag',
        name: 'Null Flag',
        emailOrDomain: 'null-flag@example.com',
        isCompany: null,
        mentionUuid: undefined,
      },
    ]);
    expect(
      mounted.fixture.root.querySelectorAll('[data-recorded-contact]')
    ).toHaveLength(9);
    expect(mounted.fixture.root.textContent).toContain('sibling stays');
  } finally {
    mounted.close();
  }
});

test('projector still rejects a person without a text name, as Source cannot render or save it', () => {
  for (const contact of [
    {
      contactId: 'p',
      name: null,
      emailOrDomain: 'p@example.com',
      isCompany: false,
    },
    { contactId: 'p', emailOrDomain: 'p@example.com', isCompany: false },
  ]) {
    expect(() => mount([contact]).close()).toThrow(
      'Invalid contact mention payload'
    );
  }
});

test('stored model refuses wrong value types before any projection', () => {
  for (const contact of [
    {
      contactId: 5,
      name: 'Five',
      emailOrDomain: 'five@example.com',
      isCompany: false,
    },
    {
      contactId: 'c',
      name: 'Text Flag',
      emailOrDomain: 'c.com',
      isCompany: 'yes',
    },
  ]) {
    expect(() => mount([contact]).close()).toThrow('JSON error: invalid type');
  }
});
