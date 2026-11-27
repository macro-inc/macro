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
        name = "contacts.lists.record_invite",
        skip_all,
        fields(added = tracing::field::Empty),
        err
    )]
    async fn record_invite(
        &self,
        owner: &MacroUserIdStr<'static>,
        contact: &MacroUserIdStr<'static>,
    ) -> Result<bool, Report> {
        let added = sqlx::query_file_scalar!(
            "src/outbound/repository/lists/record_invite.sql",
            owner.as_ref(),
            contact.as_ref(),
            ContactList::Invited.as_ref(),
        )
        .fetch_optional(&self.db)
        .await?
        .is_some();

        tracing::Span::current().record("added", added);
        Ok(added)
    }

    #[tracing::instrument(
        name = "contacts.lists.missing_profiles",
        skip_all,
        fields(ids = ids.len() as i64, missing = tracing::field::Empty),
        err
    )]
    async fn missing_profiles(
        &self,
        ids: &[MacroUserIdStr<'static>],
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        let ids = id_strings(ids);
        let missing = sqlx::query_file_scalar!(
            "src/outbound/repository/lists/missing_profiles.sql",
            &ids as &[&str],
        )
        .fetch_all(&self.db)
        .await?;

        tracing::Span::current().record("missing", missing.len() as i64);
        missing
            .into_iter()
            .map(|id| Ok(MacroUserIdStr::try_from(id)?))
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

        // Account deletion queues this just before it deletes the profile.
        // Until the profile is gone an interaction could still add the user
        // back, so refuse and let the queue deliver the message again; once it
        // is gone, interactions naming the user write nothing. A legacy
        // "User" id stored with capitals is matched by its address, as the
        // interaction writes match it.
        let profile_exists = sqlx::query_scalar!(
            r#"SELECT (
                EXISTS (SELECT 1 FROM "User" WHERE id = $1)
                OR EXISTS (SELECT 1 FROM "User" WHERE lower(email) = substr($1, 7))
            ) AS "exists!""#,
            user.as_ref(),
        )
        .fetch_one(&mut *tx)
        .await?;
        if profile_exists {
            return Err(rootcause::report!(
                "the user's profile still exists; retry after it is deleted"
            ));
        }

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
