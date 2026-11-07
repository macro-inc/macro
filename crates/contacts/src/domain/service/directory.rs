use crate::domain::{
    models::{
        contact::{Contact, ContactId, ContactPage},
        page::{ContactCursor, ContactPageSize, MAX_CONTACT_PAGE_SIZE},
        query::{CONTACT_SEARCH_SCAN_BUDGET, ContactLookup, ContactSearch},
    },
    ports::{ContactDirectory, ContactNameReader, ContactsPageService},
};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::{collections::HashMap, sync::Arc};

/// Enriches authorized graph reads using the viewer's name-resolution context.
pub struct ContactsDirectoryService<P, N> {
    pages: Arc<P>,
    names: N,
}

impl<P, N> ContactsDirectoryService<P, N> {
    /// Compose graph membership and name reads; names never create membership.
    pub fn new(pages: Arc<P>, names: N) -> Self {
        Self { pages, names }
    }
}

impl<P: ContactsPageService, N: ContactNameReader> ContactsDirectoryService<P, N> {
    async fn enrich(
        &self,
        viewer: MacroUserIdStr<'_>,
        ids: Vec<MacroUserIdStr<'static>>,
    ) -> Result<Vec<Contact>, Report> {
        if ids.len() > usize::from(MAX_CONTACT_PAGE_SIZE) {
            return Err(rootcause::report!("contact enrichment exceeded its bound"));
        }
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let names: HashMap<_, _> = self
            .names
            .contact_names(viewer.clone(), &ids)
            .await?
            .into_iter()
            .map(|name| {
                let display_name = name.display_name();
                (name.user_id, display_name)
            })
            .collect();
        Ok(ids
            .into_iter()
            .map(|user_id| Contact {
                id: ContactId::for_viewer(&viewer, &user_id),
                name: names.get(&user_id).cloned().flatten(),
                user_id,
            })
            .collect())
    }
}

impl<P: ContactsPageService, N: ContactNameReader> ContactDirectory
    for ContactsDirectoryService<P, N>
{
    #[tracing::instrument(name = "contacts.directory.page", skip_all, fields(limit = limit.get(), has_cursor = after.is_some()), err)]
    async fn contact_page(
        &self,
        viewer: MacroUserIdStr<'_>,
        after: Option<&ContactCursor>,
        limit: ContactPageSize,
    ) -> Result<ContactPage, Report> {
        let page = self
            .pages
            .contact_id_page(viewer.clone(), after, limit)
            .await?;
        if page.contacts.len() > usize::from(limit.get()) {
            return Err(rootcause::report!("contact page exceeded its bound"));
        }
        Ok(ContactPage {
            contacts: self
                .enrich(
                    viewer,
                    page.contacts.into_iter().map(|row| row.user_id).collect(),
                )
                .await?,
            next_cursor: page.next_cursor,
        })
    }

    #[tracing::instrument(name = "contacts.directory.lookup", skip_all, fields(count = lookup.ids().len()), err)]
    async fn lookup_contacts(
        &self,
        viewer: MacroUserIdStr<'_>,
        lookup: &ContactLookup,
    ) -> Result<Vec<Contact>, Report> {
        if lookup.ids().is_empty() {
            return Ok(Vec::new());
        }
        let ids = self
            .pages
            .lookup_contact_ids(viewer.clone(), lookup)
            .await?;
        if ids.len() > lookup.ids().len() {
            return Err(rootcause::report!("contact lookup exceeded its bound"));
        }
        self.enrich(viewer, ids).await
    }

    #[tracing::instrument(name = "contacts.directory.search", skip_all, fields(limit = limit.get(), has_cursor = after.is_some(), query_bytes = search.as_str().len()), err)]
    async fn search_contacts(
        &self,
        viewer: MacroUserIdStr<'_>,
        search: &ContactSearch,
        after: Option<&ContactCursor>,
        limit: ContactPageSize,
    ) -> Result<ContactPage, Report> {
        if search.as_str().is_empty() {
            return self.contact_page(viewer, after, limit).await;
        }
        let mut cursor = after.cloned();
        let mut matches = Vec::new();
        for _ in 0..CONTACT_SEARCH_SCAN_BUDGET / MAX_CONTACT_PAGE_SIZE {
            let page = self
                .pages
                .contact_id_page(viewer.clone(), cursor.as_ref(), ContactPageSize::MAX)
                .await?;
            let count = page.contacts.len();
            if count > usize::from(MAX_CONTACT_PAGE_SIZE) {
                return Err(rootcause::report!("contact scan exceeded its bound"));
            }
            if page.next_cursor.is_some() && page.next_cursor == cursor {
                return Err(rootcause::report!("contact scan did not advance"));
            }
            let contacts = self
                .enrich(
                    viewer.clone(),
                    page.contacts
                        .iter()
                        .map(|row| row.user_id.clone())
                        .collect(),
                )
                .await?;
            for (index, (row, contact)) in page.contacts.into_iter().zip(contacts).enumerate() {
                if !search.matches(&contact) {
                    continue;
                }
                matches.push(contact);
                if matches.len() == usize::from(limit.get()) {
                    return Ok(ContactPage {
                        contacts: matches,
                        next_cursor: (index + 1 < count || page.next_cursor.is_some())
                            .then_some(row.cursor),
                    });
                }
            }
            cursor = page.next_cursor;
            if cursor.is_none() {
                break;
            }
        }
        Ok(ContactPage {
            contacts: matches,
            next_cursor: cursor,
        })
    }
}

#[cfg(test)]
mod test;
