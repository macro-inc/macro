import { throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import { prepareCrmContactEdit } from '@service-storage/crm-contact-edit';
import type { CrmCompanyResponse } from '@service-storage/generated/schemas/crmCompanyResponse';
import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';
import { useMutation } from '@tanstack/solid-query';
import type { ContactEmailChange, CrmContact } from '../core/contact';
import {
  contactEditDetailsFilter,
  sameContactIdentity,
  updateContactEditDetails,
} from './contact-edit-refresh';
import type { CrmRecordDependencies } from './dependencies';
import { crmKeys } from './keys';
import { listCanIncludeCrmContacts } from './list-refresh';
import { visibilityQueryFilter } from './visibility-refresh';

export async function editContact(
  deps: CrmRecordDependencies,
  before: CrmContact,
  field: 'email' | 'company',
  save: () => ReturnType<CrmRecordDependencies['storage']['setContactEmail']>
): Promise<CrmContactResponse> {
  const cache = prepareCrmContactEdit();
  return Telemetry.span('crm.contact_edit', async (span) => {
    span.setAttr('crm.record_id', before.id);
    span.setAttr('crm.field', field);
    // A rejected write never mutates local state. Do not trace address values.
    const contact = await span.span('crm.contact_edit.save', () =>
      throwOnErr(save)
    );
    if (!cache.isCurrent()) return contact;
    try {
      const details = contactEditDetailsFilter(deps.client, before, contact);
      const refresh = async (authoritative: boolean) => {
        if (authoritative) {
          await span.span('crm.contact_edit.reconcile', () =>
            cache.invalidate(contact.id)
          );
          if (!cache.isCurrent()) return;
        }
        const lists = visibilityQueryFilter({
          kind: 'contact',
          id: contact.id,
          hidden: contact.hidden,
        });
        await span.span('crm.contact_edit.refresh', () =>
          Promise.all([
            refreshActiveGraphqlSoupQueries({
              where: listCanIncludeCrmContacts,
              unmaintainedOnly: !authoritative,
            }),
            deps.client.invalidateQueries({ predicate: lists }),
            deps.client.invalidateQueries({
              queryKey: crmKeys.quickAccessContacts.queryKey,
            }),
            deps.client.invalidateQueries({
              refetchType: 'active',
              predicate: details,
            }),
          ])
        );
        if (!authoritative || !cache.isCurrent()) return;
        // GraphQL lists can lag on a replica. Finish conflict recovery with a
        // primary read and publish it to both caches after those reads settle.
        const key = crmKeys.contact(contact.id).queryKey;
        const snapshot = deps.client.getQueryData<CrmContactResponse>(key);
        const fresh = await span.span('crm.contact_edit.primary', () =>
          throwOnErr(() => deps.storage.getContact({ contactId: contact.id }))
        );
        if (!cache.isCurrent() || deps.client.getQueryData(key) !== snapshot)
          return;
        if (
          !(await span.span('crm.contact_edit.details', () =>
            updateContactEditDetails(
              deps.client,
              snapshot ?? before,
              fresh,
              cache.isCurrent
            )
          ))
        )
          return;
        let companyName: string | null = null;
        if (fresh.companyId) {
          const companyId = fresh.companyId;
          const company = await span.span('crm.contact_edit.company', () =>
            deps.storage.getCompany({ companyId })
          );
          if (company.isOk()) companyName = company.value.name ?? null;
        }
        const current = deps.client.getQueryData<CrmContactResponse>(key);
        if (!cache.isCurrent() || !sameContactIdentity(current, fresh)) return;
        await span.span('crm.contact_edit.cache', () =>
          cache.commit(fresh, companyName)
        );
      };
      if (
        !(await span.span('crm.contact_edit.details', () =>
          updateContactEditDetails(
            deps.client,
            before,
            contact,
            cache.isCurrent,
            details
          )
        ))
      ) {
        if (cache.isCurrent()) await refresh(true);
        return contact;
      }
      let company = contact.companyId
        ? deps.client.getQueryData<CrmCompanyResponse>(
            crmKeys.company(contact.companyId).queryKey
          )
        : undefined;
      if (contact.companyId && !company) {
        const companyId = contact.companyId;
        const result = await span.span('crm.contact_edit.company', () =>
          deps.storage.getCompany({
            companyId,
          })
        );
        if (result.isOk()) company = result.value;
      }
      const current = deps.client.getQueryData<CrmContactResponse>(
        crmKeys.contact(contact.id).queryKey
      );
      if (
        !cache.isCurrent() ||
        current?.updatedAt !== contact.updatedAt ||
        !sameContactIdentity(current, contact)
      ) {
        if (cache.isCurrent()) await refresh(true);
        return contact;
      }
      await span.span('crm.contact_edit.cache', () =>
        cache.commit(contact, company?.name ?? null)
      );
      if (!cache.isCurrent()) return contact;
      await refresh(false);
    } catch (error) {
      // The write has committed. A cache/network refresh failure is not a failed save.
      span.run(() => Telemetry.error(error));
    }
    return contact;
  });
}

export function useSetContactEmailMutation(deps: CrmRecordDependencies) {
  return useMutation(
    () => ({
      mutationFn: ({
        contact,
        email,
        change,
      }: {
        contact: CrmContact;
        email: string;
        change: ContactEmailChange;
      }) =>
        editContact(deps, contact, 'email', () => {
          const write = {
            add: deps.storage.addContactEmail,
            remove: deps.storage.removeContactEmail,
            primary: deps.storage.setContactEmail,
          }[change];
          return write({ contactId: contact.id, email });
        }),
    }),
    () => deps.client
  );
}

export function useSetContactCompanyMutation(deps: CrmRecordDependencies) {
  return useMutation(
    () => ({
      mutationFn: ({
        contact,
        companyId,
      }: {
        contact: CrmContact;
        /** Null removes the company. */
        companyId: string | null;
      }) =>
        editContact(deps, contact, 'company', () =>
          companyId
            ? deps.storage.setContactCompany({
                contactId: contact.id,
                companyId,
              })
            : deps.storage.unlinkContactCompany({ contactId: contact.id })
        ),
    }),
    () => deps.client
  );
}
