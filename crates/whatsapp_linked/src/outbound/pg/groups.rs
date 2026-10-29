//! Group metadata observed by accounts, and membership reconciliation.

use super::*;
use crate::domain::ports::{GroupRepository, StoredChat, VisibleAdoption};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use external_chat::domain::timeline::{ExternalChatPersonRef, view::People};
use macro_user_id::user_id::MacroUserIdStr;

/// The same facts, ignoring when they were read and listing-only fields.
fn same_facts(stored: &GroupInfo, observed: &GroupInfo) -> bool {
    let normalize = |group: &GroupInfo| GroupInfo {
        observed_at: DateTime::<Utc>::UNIX_EPOCH,
        ..group.clone()
    };
    normalize(stored) == normalize(observed)
}

/// Store and reconcile full metadata for groups one account has joined.
/// Signals `external_chat_changed` only for what actually changed: the account's
/// list, and each affected group entity.
pub(super) async fn store_groups_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    groups: &[GroupInfo],
    complete: bool,
) -> ExternalChatResult<()> {
    let listed: Vec<String> = groups.iter().map(|g| g.jid.clone()).collect();
    // Lock the entire batch, including removals, in one stable order before
    // touching roster or membership rows. Observers may list groups differently.
    let locked = sqlx::query_scalar!(
        r#"SELECT id FROM external_chat WHERE provider = 'whatsapp' AND (remote_id = ANY($1)
        OR ($2 AND remote_id IN (SELECT group_jid FROM whatsapp_roster WHERE account_id = $3)))
        ORDER BY id FOR UPDATE"#,
        &listed,
        complete,
        account.id
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(failure)?;
    let stored: std::collections::HashMap<String, GroupInfo> = sqlx::query!(
        "SELECT group_jid, metadata FROM whatsapp_roster WHERE account_id = $1 AND group_jid = ANY($2)",
        account.id,
        &listed
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(failure)?
    .into_iter()
    .map(|row| Ok((row.group_jid, decode::<GroupInfo>(row.metadata)?)))
    .collect::<ExternalChatResult<_>>()?;
    // The newest read of each group, skipping reads older than what is stored.
    let mut fresh: std::collections::BTreeMap<&str, &GroupInfo> = Default::default();
    for group in groups {
        if stored
            .get(&group.jid)
            .is_some_and(|before| before.observed_at > group.observed_at)
        {
            continue;
        }
        let newest = fresh
            .get(group.jid.as_str())
            .is_none_or(|seen| seen.observed_at <= group.observed_at);
        if newest {
            fresh.insert(group.jid.as_str(), group);
        }
    }
    let fresh: Vec<&GroupInfo> = fresh.into_values().collect();
    let metadata = fresh
        .iter()
        .map(|group| serde_json::to_value(group).map_err(failure))
        .collect::<ExternalChatResult<Vec<_>>>()?;
    sqlx::query!(
        r#"INSERT INTO whatsapp_roster (account_id, group_jid, observed_at, metadata)
        SELECT $1, read.group_jid, read.observed_at, read.metadata
        FROM UNNEST($2::text[], $3::timestamptz[], $4::jsonb[]) AS read(group_jid, observed_at, metadata)
        ON CONFLICT (account_id, group_jid) DO UPDATE SET observed_at = excluded.observed_at, metadata = excluded.metadata
        WHERE whatsapp_roster.observed_at <= excluded.observed_at"#,
        account.id,
        &fresh.iter().map(|group| group.jid.clone()).collect::<Vec<_>>(),
        &fresh.iter().map(|group| group.observed_at).collect::<Vec<_>>(),
        &metadata,
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    let bindings = reconcile_in(tx, account, &fresh, &locked).await?;
    let mut list_changed = false;
    let mut changed_groups: Vec<Uuid> = vec![];
    let mut renames: Vec<(Uuid, String)> = vec![];
    let identity = account.identity_jid.as_deref();
    for group in &fresh {
        if stored
            .get(&group.jid)
            .is_some_and(|before| same_facts(before, group))
        {
            continue;
        }
        list_changed = true;
        for (binding, _) in bindings.iter().filter(|(_, jid)| *jid == group.jid) {
            changed_groups.push(*binding);
            if let Some(identity) = identity {
                renames.push((*binding, group.display_name(identity)));
            }
        }
    }
    sqlx::query!(
        r#"UPDATE external_chat g SET name = renamed.name
        FROM UNNEST($1::uuid[], $2::text[]) AS renamed(id, name)
        WHERE g.id = renamed.id AND g.user_id = $3 AND g.name <> renamed.name"#,
        &renames.iter().map(|(id, _)| *id).collect::<Vec<_>>(),
        &renames
            .iter()
            .map(|(_, name)| name.clone())
            .collect::<Vec<_>>(),
        account.user_id,
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    if complete {
        let observed_at = groups
            .iter()
            .map(|g| g.observed_at)
            .max()
            .unwrap_or_else(Utc::now);
        let left = sqlx::query_scalar!(
            "DELETE FROM whatsapp_roster WHERE account_id = $1 AND NOT (group_jid = ANY($2)) RETURNING group_jid",
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
        // The owner's account is always in its own direct chats: keep
        // observing them at the account's current generation.
        sqlx::query!(
            r#"INSERT INTO whatsapp_chat_membership (chat_id,account_id,generation,consent_at,remote_member,can_post,reconciled,observed_at)
            SELECT g.id,$1,$2,clock_timestamp(),true,true,true,$4 FROM external_chat g
            WHERE g.kind = 'direct' AND g.user_id = $3 AND g.state = 'active'
            ON CONFLICT (chat_id,account_id) DO UPDATE SET generation = excluded.generation, consent_ended_at = NULL,
              remote_member = true, can_post = true, reconciled = true, observed_at = excluded.observed_at
            WHERE whatsapp_chat_membership.generation <> excluded.generation
              OR whatsapp_chat_membership.consent_ended_at IS NOT NULL"#,
            account.id,
            account.generation,
            account.user_id,
            observed_at
        )
        .execute(&mut **tx)
        .await
        .map_err(failure)?;
    }
    signal_changes_in(tx, account, list_changed, changed_groups).await
}

async fn signal_changes_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    list_changed: bool,
    mut groups: Vec<Uuid>,
) -> ExternalChatResult<()> {
    if list_changed {
        notify_change(
            tx,
            Change::Chats {
                account_id: account.id,
            },
        )
        .await?;
    }
    groups.sort();
    groups.dedup();
    for chat_id in groups {
        notify_change(tx, Change::Chat { chat_id }).await?;
    }
    Ok(())
}

/// The account is no longer in this group (a live group event).
pub(super) async fn group_left_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    group: &str,
    observed_at: DateTime<Utc>,
) -> ExternalChatResult<()> {
    let listed = sqlx::query_scalar!(
        "SELECT 1 AS listed FROM whatsapp_roster WHERE account_id = $1 AND group_jid = $2",
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

/// Refresh remote membership facts from full rosters, in one statement for
/// the batch. Roster changes never grant entity access; they only confirm or
/// remove remote membership of chats the account's owner can view. Returns
/// the bindings it covered, with their group JIDs.
async fn reconcile_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    groups: &[&GroupInfo],
    locked: &[Uuid],
) -> ExternalChatResult<Vec<(Uuid, String)>> {
    let jids: Vec<String> = groups.iter().map(|group| group.jid.clone()).collect();
    let permitted: Vec<(Uuid, String)> = sqlx::query!(
        r#"SELECT b.id, b.remote_id FROM external_chat b
        WHERE b.provider = 'whatsapp' AND b.remote_id = ANY($1) AND b.id = ANY($3) AND b.state <> 'detached'
          AND external_chat_can_view(b.id, $2)
        ORDER BY b.id"#,
        &jids,
        account.user_id,
        locked
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(failure)?
    .into_iter()
    .map(|row| (row.id, row.remote_id))
    .collect();
    let identity = account.identity_jid.as_deref().unwrap_or_default();
    let facts: Vec<&GroupInfo> = permitted
        .iter()
        .filter_map(|(_, jid)| groups.iter().find(|group| &group.jid == jid).copied())
        .collect();
    sqlx::query!(
        r#"INSERT INTO whatsapp_chat_membership (chat_id,account_id,generation,consent_at,remote_member,can_post,reconciled,observed_at)
        SELECT fact.chat_id, $1, $2, clock_timestamp(), fact.remote_member, fact.can_post, true, fact.observed_at
        FROM UNNEST($3::uuid[], $4::bool[], $5::bool[], $6::timestamptz[]) AS fact(chat_id, remote_member, can_post, observed_at)
        ON CONFLICT (chat_id,account_id) DO UPDATE SET generation = excluded.generation, consent_ended_at = NULL,
        remote_member = excluded.remote_member, can_post = excluded.can_post, reconciled = true, observed_at = excluded.observed_at
        WHERE whatsapp_chat_membership.observed_at <= excluded.observed_at"#,
        account.id,
        account.generation,
        &permitted.iter().map(|(id, _)| *id).collect::<Vec<_>>(),
        &facts.iter().map(|group| group.participant(identity).is_some()).collect::<Vec<_>>(),
        &facts.iter().map(|group| group.can_post(identity)).collect::<Vec<_>>(),
        &facts.iter().map(|group| group.observed_at).collect::<Vec<_>>(),
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
) -> ExternalChatResult<()> {
    group_left_in(tx, account, group, observed_at).await
}

/// Returns the group entities whose membership facts changed.
async fn left_selected_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    group: &str,
    observed_at: DateTime<Utc>,
    locked: Option<&[Uuid]>,
) -> ExternalChatResult<Vec<Uuid>> {
    sqlx::query!("SELECT id FROM external_chat WHERE provider = 'whatsapp' AND remote_id = $1 AND ($2::uuid[] IS NULL OR id = ANY($2)) ORDER BY id FOR UPDATE", group, locked)
        .fetch_all(&mut **tx).await.map_err(failure)?;
    sqlx::query!(
        "DELETE FROM whatsapp_roster WHERE account_id = $1 AND group_jid = $2",
        account.id,
        group
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    sqlx::query_scalar!(
        r#"UPDATE whatsapp_chat_membership m SET remote_member = false, can_post = false, reconciled = true, observed_at = $4
        FROM external_chat b
        WHERE b.id = m.chat_id AND b.provider = 'whatsapp' AND b.remote_id = $1 AND m.account_id = $2 AND m.generation = $3 AND m.observed_at <= $4
          AND ($5::uuid[] IS NULL OR b.id = ANY($5))
        RETURNING m.chat_id"#,
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
impl GroupRepository for PgWhatsAppRepository {
    async fn account_groups(&self, account: Uuid) -> ExternalChatResult<Vec<GroupInfo>> {
        sqlx::query_scalar!(
            "SELECT metadata FROM whatsapp_roster WHERE account_id = $1 ORDER BY group_jid LIMIT 2000",
            account
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)?
        .into_iter()
        .map(decode)
        .collect()
    }

    async fn account_group(
        &self,
        account: Uuid,
        group: &str,
    ) -> ExternalChatResult<Option<GroupInfo>> {
        sqlx::query_scalar!(
            "SELECT metadata FROM whatsapp_roster WHERE account_id = $1 AND group_jid = $2",
            account,
            group
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(failure)?
        .map(decode)
        .transpose()
    }

    async fn request_groups_refresh(&self, accounts: &[Uuid]) -> ExternalChatResult<()> {
        if accounts.is_empty() {
            return Ok(());
        }
        let mut tx = self.pool.begin().await.map_err(failure)?;
        for account in accounts {
            notify(&mut tx, signals::GROUPS_REQUESTED, *account).await?;
        }
        tx.commit().await.map_err(failure)
    }

    async fn group_accounts(&self, chat_id: Uuid, user: &str) -> ExternalChatResult<Vec<Uuid>> {
        sqlx::query_scalar!(
            r#"SELECT m.account_id AS "account_id!" FROM whatsapp_chat_membership m
            JOIN whatsapp_linked_account a ON a.id = m.account_id
            WHERE m.chat_id = $1 AND m.consent_ended_at IS NULL AND a.state = 'connected'
            UNION
            SELECT id FROM whatsapp_linked_account WHERE user_id = $2 AND state = 'connected'"#,
            chat_id,
            user
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)
    }

    async fn visible_adoptions(
        &self,
        user: &MacroUserIdStr<'_>,
        groups: &[String],
    ) -> ExternalChatResult<Vec<VisibleAdoption>> {
        let user = user.as_ref();
        sqlx::query_as!(
            VisibleAdoption,
            r#"SELECT b.remote_id, b.id, b.name, b.user_id AS owner_id
            FROM external_chat b
            WHERE b.provider = 'whatsapp' AND b.remote_id = ANY($2) AND b.state <> 'detached' AND external_chat_can_view(b.id, $1)
            ORDER BY b.adopted_at DESC, b.id DESC"#,
            user,
            groups
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)
    }

    async fn chat_roster(&self, chat: &ChatRef) -> ExternalChatResult<Option<GroupInfo>> {
        let roster = sqlx::query_scalar!(
            r#"SELECT r.metadata FROM whatsapp_roster r
            JOIN whatsapp_chat_membership m ON m.account_id = r.account_id
            WHERE m.chat_id = $1 AND m.consent_ended_at IS NULL AND r.group_jid = $2
            ORDER BY r.observed_at DESC LIMIT 1"#,
            chat.id,
            chat.remote_id
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(failure)?
        .map(decode::<GroupInfo>)
        .transpose()?;
        let Some(mut roster) = roster else {
            return Ok(None);
        };
        // WhatsApp's group metadata has no names; people who wrote in the
        // group are known by their WhatsApp name.
        let jids: Vec<String> = roster
            .participants
            .iter()
            .filter(|participant| participant.identity.display_name.is_none())
            .flat_map(|participant| {
                [
                    Some(participant.identity.jid.clone()),
                    participant.identity.alternate_jid.clone(),
                ]
            })
            .flatten()
            .collect();
        if jids.is_empty() {
            return Ok(Some(roster));
        }
        let names = sqlx::query!(
            r#"SELECT a.jid, p.display_name AS "display_name!" FROM whatsapp_identity_alias a
            JOIN external_chat_person p ON p.id = a.person_id
            WHERE a.chat_id = $1 AND a.jid = ANY($2) AND p.display_name IS NOT NULL"#,
            chat.id,
            &jids
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)?;
        for participant in &mut roster.participants {
            let identity = &mut participant.identity;
            if identity.display_name.is_none() {
                identity.display_name = names
                    .iter()
                    .find(|row| {
                        row.jid == identity.jid
                            || identity.alternate_jid.as_deref() == Some(row.jid.as_str())
                    })
                    .map(|row| row.display_name.clone());
            }
        }
        Ok(Some(roster))
    }

    async fn account_rosters(
        &self,
        account: Uuid,
        groups: &[String],
    ) -> ExternalChatResult<Vec<GroupInfo>> {
        sqlx::query_scalar!(
            "SELECT metadata FROM whatsapp_roster WHERE account_id = $1 AND group_jid = ANY($2)",
            account,
            groups
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)?
        .into_iter()
        .map(decode)
        .collect()
    }

    async fn communities(
        &self,
        chats: &[ChatRef],
    ) -> ExternalChatResult<Vec<Option<CommunityReference>>> {
        let ids: Vec<Uuid> = chats.iter().map(|chat| chat.id).collect();
        let rows = sqlx::query!(
            r#"SELECT g.id AS "id!", seen.community_jid AS "community_jid?",
                seen.community_announcements AS "community_announcements?", parent.name AS "community_name?"
            FROM external_chat g
            LEFT JOIN LATERAL (SELECT r.metadata->>'communityJid' AS community_jid,COALESCE((r.metadata->>'communityAnnouncements')::boolean,false) AS community_announcements
              FROM whatsapp_roster r JOIN whatsapp_chat_membership m ON m.account_id=r.account_id
              WHERE m.chat_id=g.id AND m.consent_ended_at IS NULL AND r.group_jid=g.remote_id
              ORDER BY r.observed_at DESC LIMIT 1) seen ON true
            LEFT JOIN LATERAL (SELECT r.metadata->>'name' AS name
              FROM whatsapp_roster r JOIN whatsapp_chat_membership m ON m.account_id=r.account_id
              WHERE m.chat_id=g.id AND m.consent_ended_at IS NULL AND r.group_jid=seen.community_jid
              ORDER BY r.observed_at DESC LIMIT 1) parent ON true
            WHERE g.id = ANY($1)"#,
            &ids
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)?;
        Ok(chats
            .iter()
            .map(|chat| {
                let row = rows.iter().find(|row| row.id == chat.id)?;
                Some(CommunityReference::named(
                    row.community_jid.clone()?,
                    row.community_name.as_deref(),
                    row.community_announcements.unwrap_or(false),
                ))
            })
            .collect())
    }

    async fn people(&self, chat: &ChatRef, jids: &[String]) -> ExternalChatResult<People> {
        let mut people = People::new(crate::domain::jid::phone_number);
        if jids.is_empty() {
            return Ok(people);
        }
        let seen = sqlx::query!(
            r#"SELECT a.jid, p.user_id, p.display_name FROM whatsapp_identity_alias a
            JOIN external_chat_person p ON p.id = a.person_id
            WHERE a.chat_id = $1 AND a.jid = ANY($2)"#,
            chat.id,
            jids
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)?;
        let roster = sqlx::query_scalar!(
            r#"SELECT r.metadata FROM whatsapp_roster r
            JOIN whatsapp_linked_account a ON a.id = r.account_id
            JOIN external_chat g ON g.user_id = a.user_id AND g.remote_id = r.group_jid
            WHERE g.id = $1"#,
            chat.id
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(failure)?
        .map(decode::<GroupInfo>)
        .transpose()?;
        for row in seen {
            let roster_name = roster.as_ref().and_then(|roster| {
                roster
                    .participants
                    .iter()
                    .find(|participant| {
                        participant.identity.jid == row.jid
                            || participant.identity.alternate_jid.as_deref() == Some(&row.jid)
                    })
                    .and_then(|participant| participant.identity.label())
            });
            let name = row
                .display_name
                .filter(|name| !name.trim().is_empty())
                .or(roster_name);
            if let Some(name) = name {
                people.learn(
                    &row.jid,
                    ExternalChatPersonRef {
                        name,
                        user_id: row.user_id,
                    },
                );
            }
        }
        for participant in roster.iter().flat_map(|roster| &roster.participants) {
            let Some(name) = participant.identity.label() else {
                continue;
            };
            for jid in [
                Some(&participant.identity.jid),
                participant.identity.alternate_jid.as_ref(),
            ]
            .into_iter()
            .flatten()
            {
                people.learn(
                    jid,
                    ExternalChatPersonRef {
                        name: name.clone(),
                        user_id: None,
                    },
                );
            }
        }
        Ok(people)
    }
    async fn account_chats(&self, account: Uuid) -> ExternalChatResult<Vec<StoredChat>> {
        super::chats::account_chats(&self.pool, account).await
    }
}
