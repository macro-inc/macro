use super::DbContactsRepository;
use crate::domain::models::query::ContactLookup;
use crate::domain::{
    models::page::{ContactCursor, ContactIdEntry, ContactIdPage, ContactPageSize},
    ports::ContactsPageRepository,
};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;

impl ContactsPageRepository for DbContactsRepository {
    #[tracing::instrument(name = "contacts.lookup.read", skip_all, fields(count = lookup.ids().len() as i64), err)]
    async fn lookup_contact_ids(
        &self,
        viewer: MacroUserIdStr<'_>,
        lookup: &ContactLookup,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        if lookup.ids().is_empty() {
            return Ok(Vec::new());
        }
        let ids: Vec<String> = lookup.ids().iter().map(ToString::to_string).collect();
        let rows = sqlx::query_file!("src/outbound/repository/lookup.sql", viewer.as_ref(), &ids)
            .fetch_all(&self.db)
            .await?;
        Ok(rows
            .into_iter()
            .filter_map(|row| MacroUserIdStr::try_from(row.contact).ok())
            .collect())
    }

    #[tracing::instrument(name = "contacts.page.read", skip_all, fields(limit = i64::from(limit.get()), has_cursor = after.is_some()), err)]
    async fn contact_id_page(
        &self,
        viewer: MacroUserIdStr<'_>,
        after: Option<&ContactCursor>,
        limit: ContactPageSize,
    ) -> Result<ContactIdPage, Report> {
        // Canonical, unique undirected edges make the two neighbor sets disjoint.
        // Self has no edge and is merged before limiting, not appended per page.
        let mut rows = sqlx::query_file!(
            "src/outbound/repository/page.sql",
            viewer.as_ref(),
            after.map(ContactCursor::position),
            i64::from(limit.get()) + 1,
        )
        .fetch_all(&self.db)
        .await?;
        let has_more = rows.len() > usize::from(limit.get());
        rows.truncate(usize::from(limit.get()));
        // Advance through source rows before filtering malformed IDs so a bad
        // legacy row cannot strand every subsequent valid contact.
        let next_cursor = rows
            .last()
            .filter(|_| has_more)
            .map(|row| {
                ContactCursor::from_position(row.contact.clone())
                    .ok_or_else(|| rootcause::report!("invalid contact cursor in database"))
            })
            .transpose()?;
        let contacts = rows
            .into_iter()
            .filter_map(|row| ContactIdEntry::parse(row.contact))
            .collect();
        Ok(ContactIdPage {
            contacts,
            next_cursor,
        })
    }
}

#[cfg(test)]
mod test;
