//! Group metadata observed by accounts, and membership reconciliation.

use super::*;
use crate::domain::ports::GroupRepository;
use async_trait::async_trait;
use chrono::{DateTime, Utc};

/// Store and reconcile full metadata for groups one account has joined.
pub(super) async fn store_groups_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    groups: &[GroupInfo],
    complete: bool,
) -> LinkedResult<()> {
    let listed: Vec<String> = groups.iter().map(|g| g.jid.clone()).collect();
    // Lock the entire batch, including removals, in one stable order before
    // touching roster or membership rows. Observers may list groups differently.
    let locked = sqlx::query_scalar!(
        r#"SELECT id FROM whatsapp_group WHERE group_jid = ANY($1)
        OR ($2 AND group_jid IN (SELECT group_jid FROM whatsapp_group_roster WHERE account_id = $3))
        ORDER BY id FOR UPDATE"#,
        &listed,
        complete,
        account.id
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(failure)?;
    for group in groups {
        let metadata = serde_json::to_value(group).map_err(failure)?;
        sqlx::query!(
            r#"INSERT INTO whatsapp_group_roster (account_id, group_jid, observed_at, metadata) VALUES ($1, $2, $3, $4)
            ON CONFLICT (account_id, group_jid) DO UPDATE SET observed_at = excluded.observed_at, metadata = excluded.metadata
            WHERE whatsapp_group_roster.observed_at <= excluded.observed_at"#,
            account.id,
            group.jid,
            group.observed_at,
            metadata
        )
        .execute(&mut **tx)
        .await
        .map_err(failure)?;
        reconcile_in(tx, account, group, Some(&locked)).await?;
    }
    if complete {
        let observed_at = groups
            .iter()
            .map(|g| g.observed_at)
            .max()
            .unwrap_or_else(Utc::now);
        let left = sqlx::query_scalar!(
            "DELETE FROM whatsapp_group_roster WHERE account_id = $1 AND NOT (group_jid = ANY($2)) RETURNING group_jid",
            account.id,
            &listed
        )
        .fetch_all(&mut **tx)
        .await
        .map_err(failure)?;
        for group in left {
            left_selected_in(tx, account, &group, observed_at, Some(&locked)).await?;
        }
    }
    Ok(())
}

/// Bindings of this group the account observes with a current entity view access,
/// locked so competing observers serialize their snapshots.
async fn permitted_bindings_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    group: &str,
    locked: Option<&[Uuid]>,
) -> LinkedResult<Vec<Uuid>> {
    sqlx::query!(
        "SELECT id FROM whatsapp_group WHERE group_jid = $1 AND ($2::uuid[] IS NULL OR id = ANY($2)) ORDER BY id FOR UPDATE",
        group, locked
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(failure)?;
    sqlx::query_scalar!(
        r#"SELECT b.id FROM whatsapp_group b
        WHERE b.group_jid = $1 AND b.state <> 'detached' AND whatsapp_group_can_view(b.id, $2)
          AND ($3::uuid[] IS NULL OR b.id = ANY($3))"#,
        group,
        account.user_id,
        locked
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(failure)
}

/// Refresh remote membership facts from a full roster. Roster changes
/// never grant entity access; they only confirm or remove remote membership.
async fn reconcile_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    group: &GroupInfo,
    locked: Option<&[Uuid]>,
) -> LinkedResult<()> {
    let permitted = permitted_bindings_in(tx, account, &group.jid, locked).await?;
    if permitted.is_empty() {
        return Ok(());
    }
    let identity = account.identity_jid.as_deref().unwrap_or_default();
    for binding in &permitted {
        sqlx::query!(r#"INSERT INTO whatsapp_group_membership (binding_id,account_id,generation,consent_at,remote_member,can_post,reconciled,observed_at)
            SELECT $1,$2,$3,clock_timestamp(),$4,$5,true,$6
            ON CONFLICT (binding_id,account_id) DO UPDATE SET generation = excluded.generation, consent_ended_at = NULL,
            remote_member = excluded.remote_member, can_post = excluded.can_post, reconciled = true, observed_at = excluded.observed_at
            WHERE whatsapp_group_membership.observed_at <= excluded.observed_at"#,
            binding,account.id,account.generation,group.participant(identity).is_some(),group.can_post(identity),group.observed_at)
            .execute(&mut **tx).await.map_err(failure)?;
    }

    let member = group.participant(identity).is_some();
    sqlx::query!(
        r#"UPDATE whatsapp_group_membership SET remote_member = $3, can_post = $4, observed_at = $5, reconciled = true
        WHERE account_id = $1 AND binding_id = ANY($2) AND observed_at <= $5"#,
        account.id,
        &permitted,
        member,
        group.can_post(identity),
        group.observed_at
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    let suspended = group.disappearing || group.community;
    sqlx::query!(
        r#"UPDATE whatsapp_group SET state = CASE WHEN $2 THEN 'suspended' ELSE 'active' END
        WHERE id = ANY($1) AND state = CASE WHEN $2 THEN 'active' ELSE 'suspended' END"#,
        &permitted,
        suspended
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    Ok(())
}

/// The account left or was removed: a scoped negative fact, even when the full
/// roster can no longer be read.
pub(super) async fn left_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    group: &str,
    observed_at: DateTime<Utc>,
) -> LinkedResult<()> {
    left_selected_in(tx, account, group, observed_at, None).await
}

async fn left_selected_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    group: &str,
    observed_at: DateTime<Utc>,
    locked: Option<&[Uuid]>,
) -> LinkedResult<()> {
    sqlx::query!("SELECT id FROM whatsapp_group WHERE group_jid = $1 AND ($2::uuid[] IS NULL OR id = ANY($2)) ORDER BY id FOR UPDATE", group, locked)
        .fetch_all(&mut **tx).await.map_err(failure)?;
    sqlx::query!(
        "DELETE FROM whatsapp_group_roster WHERE account_id = $1 AND group_jid = $2",
        account.id,
        group
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    sqlx::query!(
        r#"UPDATE whatsapp_group_membership m SET remote_member = false, can_post = false, reconciled = true, observed_at = $4
        FROM whatsapp_group b
        WHERE b.id = m.binding_id AND b.group_jid = $1 AND m.account_id = $2 AND m.generation = $3 AND m.observed_at <= $4
          AND ($5::uuid[] IS NULL OR b.id = ANY($5))"#,
        group,
        account.id,
        account.generation,
        observed_at,
        locked
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    Ok(())
}

#[async_trait]
impl GroupRepository for PgLinkedRepository {
    async fn user_team(&self, user: &str) -> LinkedResult<Option<Uuid>> {
        sqlx::query_scalar!(
            "SELECT team_id FROM team_user WHERE user_id=$1 ORDER BY team_role DESC LIMIT 1",
            user
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(failure)
    }
    async fn account_groups(&self, account: Uuid) -> LinkedResult<Vec<GroupInfo>> {
        sqlx::query_scalar!(
            "SELECT metadata FROM whatsapp_group_roster WHERE account_id = $1 ORDER BY group_jid LIMIT 2000",
            account
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)?
        .into_iter()
        .map(decode)
        .collect()
    }

    async fn account_group(&self, account: Uuid, group: &str) -> LinkedResult<Option<GroupInfo>> {
        sqlx::query_scalar!(
            "SELECT metadata FROM whatsapp_group_roster WHERE account_id = $1 AND group_jid = $2",
            account,
            group
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(failure)?
        .map(decode)
        .transpose()
    }

    async fn request_groups_refresh(&self, account: Uuid) -> LinkedResult<()> {
        sqlx::query!(
            "SELECT pg_notify($1, $2)",
            signals::GROUPS_REQUESTED,
            account.to_string()
        )
        .execute(&self.pool)
        .await
        .map_err(failure)?;
        Ok(())
    }

    async fn visible_adoptions(
        &self,
        user: &str,
        groups: &[String],
    ) -> LinkedResult<Vec<(String, GroupReference)>> {
        Ok(sqlx::query!(
            r#"SELECT b.group_jid, b.id, b.name
            FROM whatsapp_group b
            WHERE b.group_jid = ANY($2) AND b.state <> 'detached' AND whatsapp_group_can_view(b.id, $1)"#,
            user,
            groups
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)?
        .into_iter()
        .map(|row| {
            (
                row.group_jid,
                GroupReference {
                    id: row.id,
                    name: row.name,
                },
            )
        })
        .collect())
    }

    async fn binding_roster(&self, binding: &Binding) -> LinkedResult<Option<GroupInfo>> {
        sqlx::query_scalar!(
            r#"SELECT r.metadata FROM whatsapp_group_roster r
            JOIN whatsapp_group_membership m ON m.account_id = r.account_id
            WHERE m.binding_id = $1 AND m.consent_ended_at IS NULL AND r.group_jid = $2
            ORDER BY r.observed_at DESC LIMIT 1"#,
            binding.id,
            binding.group_jid
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(failure)?
        .map(decode)
        .transpose()
    }
}
