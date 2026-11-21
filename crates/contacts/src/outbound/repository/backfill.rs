use super::DbContactsRepository;
use crate::domain::models::backfill::{
    ChannelMember, ChannelRecord, ChannelSnapshot, ChannelType, Inbox, InboxContact, InboxOwner,
    LegacyEdge, OrphanCheck, OrphanKind,
};
use crate::domain::models::list::{ContactList, InboxProvider};
use crate::domain::ports::{LegacyDirectorySource, OrphanedListRows};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::str::FromStr;
use uuid::Uuid;

#[cfg(test)]
mod test;

impl LegacyDirectorySource for DbContactsRepository {
    #[tracing::instrument(name = "contacts.backfill.channel_page", skip(self), err)]
    async fn channel_page(&self, after: Uuid, limit: i64) -> Result<Vec<ChannelRecord>, Report> {
        let rows = sqlx::query_file!(
            "src/outbound/repository/backfill/channel_page.sql",
            after,
            limit
        )
        .fetch_all(&self.db)
        .await?;

        rows.into_iter()
            .map(|row| {
                Ok(ChannelRecord {
                    id: row.id,
                    channel_type: ChannelType::from_str(&row.channel_type)?,
                    support_name: row.support_name,
                })
            })
            .collect()
    }

    #[tracing::instrument(
        name = "contacts.backfill.channel_members",
        skip_all,
        fields(channels = channels.len() as i64, members = tracing::field::Empty),
        err
    )]
    async fn channel_members(&self, channels: &[Uuid]) -> Result<Vec<ChannelMember>, Report> {
        let rows = sqlx::query_file!(
            "src/outbound/repository/backfill/channel_members.sql",
            channels
        )
        .fetch_all(&self.db)
        .await?;

        tracing::Span::current().record("members", rows.len() as i64);
        // An id the user-id parser rejects is not a person anyone can list.
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                Some(ChannelMember {
                    channel_id: row.channel_id,
                    user: MacroUserIdStr::try_from(row.user_id).ok()?,
                    joined_at: row.joined_at,
                    left_at: row.left_at,
                })
            })
            .collect())
    }

    #[tracing::instrument(name = "contacts.backfill.snapshot_page", skip(self), err)]
    async fn snapshot_page(&self, after: i32, limit: i64) -> Result<Vec<ChannelSnapshot>, Report> {
        let rows = sqlx::query_file!(
            "src/outbound/repository/backfill/snapshot_page.sql",
            after,
            limit
        )
        .fetch_all(&self.db)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| ChannelSnapshot {
                id: row.id,
                channel_id: row.channel_id,
                taken_at: row.created_at,
                users: row
                    .user_ids
                    .into_iter()
                    .filter_map(|id| MacroUserIdStr::try_from(id).ok())
                    .collect(),
            })
            .collect())
    }

    #[tracing::instrument(
        name = "contacts.backfill.direct_messages",
        skip(self, channels),
        fields(channels = channels.len() as i64, with_message = tracing::field::Empty),
        err
    )]
    async fn direct_messages_with_person_message(
        &self,
        channels: &[Uuid],
        since: Option<DateTime<Utc>>,
    ) -> Result<Vec<Uuid>, Report> {
        let ids = sqlx::query_file_scalar!(
            "src/outbound/repository/backfill/direct_messages_with_person_message.sql",
            channels,
            since
        )
        .fetch_all(&self.db)
        .await?;

        tracing::Span::current().record("with_message", ids.len() as i64);
        Ok(ids)
    }

    #[tracing::instrument(
        name = "contacts.backfill.inbox_owner_page",
        skip_all,
        fields(limit),
        err
    )]
    async fn inbox_owner_page(&self, after: &str, limit: i64) -> Result<Vec<InboxOwner>, Report> {
        let rows = sqlx::query_file!(
            "src/outbound/repository/backfill/inbox_owner_page.sql",
            after,
            limit
        )
        .fetch_all(&self.db)
        .await?;

        rows.into_iter()
            .map(|row| {
                let inboxes = row
                    .link_ids
                    .into_iter()
                    .zip(row.providers)
                    .map(|(link_id, value)| {
                        Ok(Inbox {
                            link_id,
                            provider: InboxProvider::from_str(&value).map_err(|error| {
                                let label = value
                                    .chars()
                                    .take(64)
                                    .flat_map(char::escape_default)
                                    .collect::<String>();
                                Report::new(error)
                                    .context(format!("unknown inbox provider {label}"))
                                    .into_dynamic()
                            })?,
                        })
                    })
                    .collect::<Result<_, Report>>()?;
                Ok(InboxOwner {
                    owner: row.owner,
                    inboxes,
                })
            })
            .collect()
    }

    #[tracing::instrument(
        name = "contacts.backfill.inbox_contact_page",
        skip_all,
        fields(inboxes = inboxes.len() as i64, limit, matched = tracing::field::Empty),
        err
    )]
    async fn inbox_contact_page(
        &self,
        owner: &str,
        inboxes: &[Uuid],
        after: &str,
        limit: i64,
    ) -> Result<Vec<InboxContact>, Report> {
        let rows = sqlx::query_file!(
            "src/outbound/repository/backfill/inbox_contact_page.sql",
            owner,
            after,
            limit,
            inboxes
        )
        .fetch_all(&self.db)
        .await?;

        let matched = rows.iter().filter(|row| !row.link_ids.is_empty()).count();
        tracing::Span::current().record("matched", matched as i64);
        Ok(rows
            .into_iter()
            .map(|row| InboxContact {
                peer: row.peer,
                link_ids: row.link_ids,
            })
            .collect())
    }

    #[tracing::instrument(name = "contacts.backfill.legacy_edge_page", skip(self), err)]
    async fn legacy_edge_page(&self, after: i32, limit: i64) -> Result<Vec<LegacyEdge>, Report> {
        let rows = sqlx::query_file!(
            "src/outbound/repository/backfill/legacy_edge_page.sql",
            after,
            limit,
            ContactList::Invited.as_ref()
        )
        .fetch_all(&self.db)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| LegacyEdge {
                id: row.id,
                user1: row.user1,
                user2: row.user2,
                teammates: row.teammates,
                user1_invited_user2: row.user1_invited_user2,
                user2_invited_user1: row.user2_invited_user1,
                user1_inbox_has_user2: row.user1_inbox_has_user2,
                user2_inbox_has_user1: row.user2_inbox_has_user1,
                user1_disconnected_inbox: row.user1_disconnected_inbox,
                user2_disconnected_inbox: row.user2_disconnected_inbox,
                referral: row.referral,
            })
            .collect())
    }
}

impl OrphanedListRows for DbContactsRepository {
    #[tracing::instrument(
        name = "contacts.backfill.orphan_page",
        skip(self, after),
        fields(orphans = tracing::field::Empty),
        err
    )]
    async fn orphan_page(
        &self,
        kind: OrphanKind,
        after: &str,
        limit: i64,
    ) -> Result<Vec<OrphanCheck>, Report> {
        let interacted = ContactList::Interacted.as_ref();
        let rows: Vec<(String, Option<i64>)> = match kind {
            OrphanKind::ListOwner => sqlx::query_file!(
                "src/outbound/repository/backfill/orphan_list_owners.sql",
                after,
                limit
            )
            .fetch_all(&self.db)
            .await?
            .into_iter()
            .map(|row| (row.id, row.orphaned_rows))
            .collect(),
            OrphanKind::InboxOwner => sqlx::query_file!(
                "src/outbound/repository/backfill/orphan_inbox_owners.sql",
                after,
                limit
            )
            .fetch_all(&self.db)
            .await?
            .into_iter()
            .map(|row| (row.id, row.orphaned_rows))
            .collect(),
            OrphanKind::InteractedContact => sqlx::query_file!(
                "src/outbound/repository/backfill/orphan_interacted_contacts.sql",
                after,
                limit,
                interacted
            )
            .fetch_all(&self.db)
            .await?
            .into_iter()
            .map(|row| (row.id, row.orphaned_rows))
            .collect(),
        };

        let orphans = rows.iter().filter(|(_, rows)| rows.is_some()).count();
        tracing::Span::current().record("orphans", orphans as i64);
        Ok(rows
            .into_iter()
            .map(|(id, orphaned_rows)| OrphanCheck { id, orphaned_rows })
            .collect())
    }

    #[tracing::instrument(
        name = "contacts.backfill.delete_orphan_rows",
        skip(self, id),
        fields(deleted = tracing::field::Empty),
        err
    )]
    async fn delete_orphan_rows(
        &self,
        kind: OrphanKind,
        id: &str,
        limit: i64,
    ) -> Result<u64, Report> {
        let result = match kind {
            OrphanKind::ListOwner => {
                sqlx::query_file!(
                    "src/outbound/repository/backfill/delete_list_owner_rows.sql",
                    id,
                    limit
                )
                .execute(&self.db)
                .await?
            }
            OrphanKind::InboxOwner => {
                sqlx::query_file!(
                    "src/outbound/repository/backfill/delete_inbox_owner_rows.sql",
                    id,
                    limit
                )
                .execute(&self.db)
                .await?
            }
            OrphanKind::InteractedContact => {
                sqlx::query_file!(
                    "src/outbound/repository/backfill/delete_interacted_contact_rows.sql",
                    id,
                    limit,
                    ContactList::Interacted.as_ref()
                )
                .execute(&self.db)
                .await?
            }
        };

        tracing::Span::current().record("deleted", result.rows_affected() as i64);
        Ok(result.rows_affected())
    }
}
