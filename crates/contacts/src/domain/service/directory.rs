use crate::domain::{
    models::{
        contact::{Contact, ContactId, ContactPage},
        list::ContactList,
        page::{ContactCursor, ContactPageSize, MAX_CONTACT_PAGE_SIZE},
        query::{CONTACT_SEARCH_SCAN_BUDGET, ContactLookup, ContactSearch},
    },
    ports::{ContactDirectory, ContactListReader, ContactNameReader, ContactsPageService},
};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::{collections::HashMap, sync::Arc};

/// Enriches authorized directory reads with the viewer's names and lists.
pub struct ContactsDirectoryService<P, L, N> {
    pages: Arc<P>,
    lists: Arc<L>,
    names: N,
}

impl<P, L, N> ContactsDirectoryService<P, L, N> {
    /// Compose membership (`pages`), list (`lists`) and name reads. Names and
    /// lists never create membership: they are read only for the ids `pages`
    /// chose.
    pub fn new(pages: Arc<P>, lists: Arc<L>, names: N) -> Self {
        Self {
            pages,
            lists,
            names,
        }
    }
}

impl<P: ContactsPageService, L: ContactListReader, N: ContactNameReader>
    ContactsDirectoryService<P, L, N>
{
    /// Name the chosen ids, in order, without their lists.
    async fn named(
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
                lists: Vec::new(),
                user_id,
            })
            .collect())
    }

    /// The viewer's lists for each chosen contact, by id. Read from the
    /// list-aware directory whichever store chose the ids, so a contact only
    /// the legacy graph knows has none.
    async fn lists_of(
        &self,
        viewer: MacroUserIdStr<'_>,
        ids: Vec<MacroUserIdStr<'static>>,
    ) -> Result<HashMap<MacroUserIdStr<'static>, Vec<ContactList>>, Report> {
        let Some(lookup) = ContactLookup::new(ids) else {
            return Err(rootcause::report!("contact list read exceeded its bound"));
        };
        if lookup.ids().is_empty() {
            return Ok(HashMap::new());
        }
        Ok(self
            .lists
            .contact_lists(viewer, &lookup)
            .await?
            .into_iter()
            .map(|listed| (listed.user_id, listed.lists))
            .collect())
    }

    /// Add the viewer's lists to contacts already named.
    async fn listed(
        &self,
        viewer: MacroUserIdStr<'_>,
        contacts: Vec<Contact>,
    ) -> Result<Vec<Contact>, Report> {
        let lists = self
            .lists_of(
                viewer,
                contacts
                    .iter()
                    .map(|contact| contact.user_id.clone())
                    .collect(),
            )
            .await?;
        Ok(with_lists(contacts, lists))
    }

    /// Name the chosen ids and read their lists, concurrently.
    async fn enrich(
        &self,
        viewer: MacroUserIdStr<'_>,
        ids: Vec<MacroUserIdStr<'static>>,
    ) -> Result<Vec<Contact>, Report> {
        let (contacts, lists) = tokio::try_join!(
            self.named(viewer.clone(), ids.clone()),
            self.lists_of(viewer.clone(), ids),
        )?;
        Ok(with_lists(contacts, lists))
    }
}

/// Legacy pages can name one canonical id twice (case variants), so each
/// contact copies its lists rather than taking them.
fn with_lists(
    mut contacts: Vec<Contact>,
    lists: HashMap<MacroUserIdStr<'static>, Vec<ContactList>>,
) -> Vec<Contact> {
    for contact in &mut contacts {
        if let Some(contact_lists) = lists.get(&contact.user_id) {
            contact.lists.clone_from(contact_lists);
        }
    }
    contacts
}

impl<P: ContactsPageService, L: ContactListReader, N: ContactNameReader> ContactDirectory
    for ContactsDirectoryService<P, L, N>
{
    #[tracing::instrument(name = "contacts.directory.page", skip_all, fields(limit = i64::from(limit.get()), has_cursor = after.is_some()), err)]
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

    #[tracing::instrument(name = "contacts.directory.lookup", skip_all, fields(count = lookup.ids().len() as i64), err)]
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

    #[tracing::instrument(name = "contacts.directory.search", skip_all, fields(limit = i64::from(limit.get()), has_cursor = after.is_some(), query_bytes = search.as_str().len() as i64), err)]
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
                .named(
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
                        contacts: self.listed(viewer, matches).await?,
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
            contacts: self.listed(viewer, matches).await?,
            next_cursor: cursor,
        })
    }
}

#[cfg(test)]
mod test;
