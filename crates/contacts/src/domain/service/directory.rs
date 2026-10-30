use crate::domain::{
    models::{
        contact::{Contact, ContactId, ContactPage},
        page::{ContactCursor, ContactPageSize},
    },
    ports::{ContactDirectory, ContactNameReader, ContactsPageService},
};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::{collections::HashMap, sync::Arc};

/// Enriches one authorized graph page using the viewer's name-resolution context.
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
        let names = if page.contacts.is_empty() {
            Vec::new()
        } else {
            self.names
                .contact_names(viewer.clone(), &page.contacts)
                .await?
        };
        let names: HashMap<_, _> = names
            .into_iter()
            .map(|name| {
                let display_name = name.display_name();
                (name.user_id, display_name)
            })
            .collect();
        Ok(ContactPage {
            contacts: page
                .contacts
                .into_iter()
                .map(|user_id| Contact {
                    id: ContactId::for_viewer(&viewer, &user_id),
                    name: names.get(&user_id).cloned().flatten(),
                    user_id,
                })
                .collect(),
            next_cursor: page.next_cursor,
        })
    }
}

#[cfg(test)]
mod test;
