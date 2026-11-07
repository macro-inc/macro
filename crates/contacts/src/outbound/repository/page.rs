use super::DbContactsRepository;
use crate::domain::{
    models::page::{ContactCursor, ContactIdPage, ContactPageSize},
    ports::ContactsPageRepository,
};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;

impl ContactsPageRepository for DbContactsRepository {
    #[tracing::instrument(name = "contacts.page.read", skip_all, fields(limit = limit.get(), has_cursor = after.is_some()), err)]
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
            .filter_map(|row| MacroUserIdStr::try_from(row.contact).ok())
            .collect();
        Ok(ContactIdPage {
            contacts,
            next_cursor,
        })
    }
}

#[cfg(test)]
mod test;
