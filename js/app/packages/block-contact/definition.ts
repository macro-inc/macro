import { defineBlock, type ExtractLoadType, LoadErrors } from '@core/block';
import type { ContactInfo } from '@core/user';
import { isErr, ok } from '@core/util/maybeResult';
import { emailClient } from '@service-email/client';
import { UnfurlServiceClient } from '@service-unfurl/client';
import BlockContact from './component/Block';

export const definition = defineBlock({
  name: 'contact',
  description: 'View and manage contact information',
  accepted: {},
  component: BlockContact,

  async load(source, _intent) {
    if (source.type === 'dss') {
      // The source.id will be the email address or domain
      const id = decodeURIComponent(source.id);

      // Check if it's a domain (starts with @) or email address
      const isDomain = id.startsWith('@');
      const type = isDomain ? 'company' : 'person';

      if (type === 'company') {
        // For companies, get the domain without @
        const domain = id.substring(1);

        // Try to unfurl the company website to get logo/favicon
        let unfurlData = null;
        try {
          const unfurlResult = await UnfurlServiceClient.unfurl({
            url: `https://${domain}`,
          });
          if (!isErr(unfurlResult)) {
            const [, data] = unfurlResult;
            unfurlData = data;
          }
        } catch (error) {
          console.error('Failed to unfurl company website:', error);
        }

        return ok({
          type: 'company' as const,
          domain: id, // Keep the @ prefix
          unfurlData,
          email: null,
          contact: null,
        });
      }

      // For individual contacts
      const email = id;

      // Get contact data from the email service
      const contactsResponse = await emailClient.listContacts();

      if (isErr(contactsResponse)) {
        return LoadErrors.INVALID;
      }

      const [, data] = contactsResponse;
      let foundContact: ContactInfo | null = null;

      // Search through all contacts to find the one with matching email
      for (const contacts of Object.values(data.contacts)) {
        const match = contacts.find(
          (c) => c.email_address.toLowerCase() === email.toLowerCase()
        );
        if (match) {
          foundContact = match;
          break;
        }
      }

      if (!foundContact) {
        // If no contact found in email service, create a basic contact object
        foundContact = {
          email,
          name: null,
        };
      }

      return ok({
        type: 'person' as const,
        email,
        contact: foundContact,
        domain: null,
        unfurlData: null,
      });
    }
    return LoadErrors.INVALID;
  },
});

export type ContactData = ExtractLoadType<(typeof definition)['load']>;
