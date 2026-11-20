use super::DbContactsRepository;
use crate::domain::models::list::{ContactList, InboxSource};
use crate::domain::ports::ContactListRepository;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;

#[cfg(test)]
mod test;

fn id_strings<'a>(ids: &'a [MacroUserIdStr<'static>]) -> Vec<&'a str> {
    ids.iter().map(|id| id.as_ref()).collect()
}

impl ContactListRepository for DbContactsRepository {
    #[tracing::instrument(
        name = "contacts.lists.record_interactions",
        skip_all,
        fields(users = users.len() as i64, peers = peers.len() as i64, added = tracing::field::Empty),
        err
    )]
    async fn record_interactions(
        &self,
        users: &[MacroUserIdStr<'static>],
        peers: &[MacroUserIdStr<'static>],
    ) -> Result<Vec<(MacroUserIdStr<'static>, MacroUserIdStr<'static>)>, Report> {
        if users.is_empty() || peers.is_empty() {
            return Ok(Vec::new());
        }

        let users = id_strings(users);
        let peers = id_strings(peers);
        let rows = sqlx::query_file!(
            "src/outbound/repository/lists/record_interactions.sql",
            &users as &[&str],
            &peers as &[&str],
            ContactList::Interacted.as_ref(),
        )
        .fetch_all(&self.db)
        .await?;

        tracing::Span::current().record("added", rows.len() as i64);
        rows.into_iter()
            .map(|row| {
                Ok((
                    MacroUserIdStr::try_from(row.user_id)?,
                    MacroUserIdStr::try_from(row.contact_user_id)?,
                ))
            })
            .collect()
    }

    #[tracing::instrument(
        name = "contacts.lists.record_inbox_contacts",
        skip_all,
        fields(link_id = %inbox.link_id, contacts = contacts.len() as i64, added = tracing::field::Empty),
        err
    )]
    async fn record_inbox_contacts(
        &self,
        inbox: &InboxSource,
        contacts: &[MacroUserIdStr<'static>],
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        if contacts.is_empty() {
            return Ok(Vec::new());
        }

        let list = ContactList::from(inbox.provider);
        let contacts = id_strings(contacts);
        let rows = sqlx::query_file!(
            "src/outbound/repository/lists/record_inbox_contacts.sql",
            inbox.owner.as_ref(),
            inbox.link_id,
            list.as_ref(),
            &contacts as &[&str],
        )
        .fetch_all(&self.db)
        .await?;

        tracing::Span::current().record("added", rows.len() as i64);
        rows.into_iter()
            .map(|row| Ok(MacroUserIdStr::try_from(row.contact_user_id)?))
            .collect()
    }

    #[tracing::instrument(
        name = "contacts.lists.delete_user",
        skip_all,
        fields(owners = tracing::field::Empty),
        err
    )]
    async fn delete_user_lists(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        // The work grows with the user's directory and how many directories
        // they are in, so bound it.
        let mut tx = self.db.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '30s'")
            .execute(&mut *tx)
            .await?;
        let owners = sqlx::query_file_scalar!(
            "src/outbound/repository/lists/delete_user_lists.sql",
            user.as_ref(),
        )
        .fetch_all(&mut *tx)
        .await?;
        tx.commit().await?;

        tracing::Span::current().record("owners", owners.len() as i64);
        owners
            .into_iter()
            .map(|owner| Ok(MacroUserIdStr::try_from(owner)?))
            .collect()
    }
}
