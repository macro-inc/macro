//! Group metadata observed by accounts, and membership reconciliation.

use super::*;
use crate::domain::ports::{GroupRepository, VisibleAdoption};
use async_trait::async_trait;
use chrono::{DateTime, Utc};

/// The same facts, ignoring when they were read and listing-only fields.
fn same_facts(stored: &GroupInfo, observed: &GroupInfo) -> bool {
    let normalize = |group: &GroupInfo| GroupInfo {
        observed_at: DateTime::<Utc>::UNIX_EPOCH,
        group: None,
        shared: None,
        ..group.clone()
    };
    normalize(stored) == normalize(observed)
}

/// Store and reconcile full metadata for groups one account has joined.
/// Signals `whatsapp_changed` only for what actually changed: the account's
/// list, and each affected group entity.
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
    let stored: std::collections::HashMap<String, GroupInfo> = sqlx::query!(
        "SELECT group_jid, metadata FROM whatsapp_group_roster WHERE account_id = $1 AND group_jid = ANY($2)",
        account.id,
        &listed
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(failure)?
    .into_iter()
    .map(|row| Ok((row.group_jid, decode::<GroupInfo>(row.metadata)?)))
    .collect::<LinkedResult<_>>()?;
    let mut list_changed = false;
    let mut changed_groups: Vec<Uuid> = vec![];
    for group in groups {
        let before = stored.get(&group.jid);
        if before.is_some_and(|before| before.observed_at > group.observed_at) {
            continue;
        }
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
        let bindings = reconcile_in(tx, account, group, Some(&locked)).await?;
        if before.is_some_and(|before| same_facts(before, group)) {
            continue;
        }
        list_changed = true;
        rename_in(tx, account, group, &bindings).await?;
        changed_groups.extend(bindings);
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
            list_changed = true;
            changed_groups
                .extend(left_selected_in(tx, account, &group, observed_at, Some(&locked)).await?);
        }
    }
    signal_changes_in(tx, account, list_changed, changed_groups).await
}

async fn signal_changes_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    list_changed: bool,
    mut groups: Vec<Uuid>,
) -> LinkedResult<()> {
    if list_changed {
        notify_change(
            tx,
            signals::Change::Groups {
                account_id: account.id,
            },
        )
        .await?;
    }
    groups.sort();
    groups.dedup();
    for group_id in groups {
        notify_change(tx, signals::Change::Group { group_id }).await?;
    }
    Ok(())
}

/// The account's owner named their own group entities after WhatsApp: keep
/// following the subject (or member names for an unnamed group).
async fn rename_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    group: &GroupInfo,
    bindings: &[Uuid],
) -> LinkedResult<()> {
    let Some(identity) = account.identity_jid.as_deref() else {
        return Ok(());
    };
    sqlx::query!(
        "UPDATE whatsapp_group SET name = $3 WHERE id = ANY($1) AND user_id = $2 AND name <> $3",
        bindings,
        account.user_id,
        group.display_name(identity)
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    Ok(())
}

/// The account is no longer in this group (a live group event).
pub(super) async fn group_left_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    group: &str,
    observed_at: DateTime<Utc>,
) -> LinkedResult<()> {
    let listed = sqlx::query_scalar!(
        "SELECT 1 AS listed FROM whatsapp_group_roster WHERE account_id = $1 AND group_jid = $2",
        account.id,
        group
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(failure)?
    .is_some();
    let bindings = left_selected_in(tx, account, group, observed_at, None).await?;
    signal_changes_in(tx, account, listed, bindings).await
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
) -> LinkedResult<Vec<Uuid>> {
    let permitted = permitted_bindings_in(tx, account, &group.jid, locked).await?;
    if permitted.is_empty() {
        return Ok(permitted);
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
    Ok(permitted)
}

/// The account left or was removed: a scoped negative fact, even when the full
/// roster can no longer be read.
pub(super) async fn left_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    group: &str,
    observed_at: DateTime<Utc>,
) -> LinkedResult<()> {
    group_left_in(tx, account, group, observed_at).await
}

/// Returns the group entities whose membership facts changed.
async fn left_selected_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    group: &str,
    observed_at: DateTime<Utc>,
    locked: Option<&[Uuid]>,
) -> LinkedResult<Vec<Uuid>> {
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
    sqlx::query_scalar!(
        r#"UPDATE whatsapp_group_membership m SET remote_member = false, can_post = false, reconciled = true, observed_at = $4
        FROM whatsapp_group b
        WHERE b.id = m.binding_id AND b.group_jid = $1 AND m.account_id = $2 AND m.generation = $3 AND m.observed_at <= $4
          AND ($5::uuid[] IS NULL OR b.id = ANY($5))
        RETURNING m.binding_id"#,
        group,
        account.id,
        account.generation,
        observed_at,
        locked
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(failure)
}

#[async_trait]
impl GroupRepository for PgLinkedRepository {
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

    async fn request_groups_refresh(&self, accounts: &[Uuid]) -> LinkedResult<()> {
        if accounts.is_empty() {
            return Ok(());
        }
        let mut tx = self.pool.begin().await.map_err(failure)?;
        for account in accounts {
            notify(&mut tx, signals::GROUPS_REQUESTED, *account).await?;
        }
        tx.commit().await.map_err(failure)
    }

    async fn group_accounts(&self, group_id: Uuid, user: &str) -> LinkedResult<Vec<Uuid>> {
        sqlx::query_scalar!(
            r#"SELECT m.account_id AS "account_id!" FROM whatsapp_group_membership m
            JOIN whatsapp_linked_account a ON a.id = m.account_id
            WHERE m.binding_id = $1 AND m.consent_ended_at IS NULL AND a.state = 'connected'
            UNION
            SELECT id FROM whatsapp_linked_account WHERE user_id = $2 AND state = 'connected'"#,
            group_id,
            user
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)
    }

    async fn visible_adoptions(
        &self,
        user: &str,
        groups: &[String],
    ) -> LinkedResult<Vec<VisibleAdoption>> {
        sqlx::query_as!(
            VisibleAdoption,
            r#"SELECT b.group_jid, b.id, b.name, b.user_id AS owner_id
            FROM whatsapp_group b
            WHERE b.group_jid = ANY($2) AND b.state <> 'detached' AND whatsapp_group_can_view(b.id, $1)
            ORDER BY b.adopted_at DESC, b.id DESC"#,
            user,
            groups
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)
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
