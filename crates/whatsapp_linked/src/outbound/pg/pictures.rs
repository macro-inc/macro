//! Profile pictures (`whatsapp_profile_picture`), one row per observing
//! account and JID. The session service checks due rows within a per-account
//! budget and stages new pictures' bytes; DSS stores them as static files
//! (`static_file_id`, the only column the read path joins on). A file a row
//! lets go of is queued in `external_chat_file_deletion` by a trigger.

use super::*;
use crate::domain::{
    events::{PictureAnswer, PictureCheck},
    ports::PictureRepository,
};
use async_trait::async_trait;

/// Failed checks or imports before a picture is marked `failed`.
const MAX_PICTURE_ATTEMPTS: i32 = 5;
/// A settled picture (stored, not set, or failed) is checked again after
/// this many days, plus up to [`RECHECK_SPREAD_DAYS`] so checks don't bunch
/// up.
const RECHECK_DAYS: i32 = 6;
/// A hidden picture's privacy setting rarely flips: checked again after this
/// many days, plus the spread.
const HIDDEN_RECHECK_DAYS: i32 = 13;
/// See [`RECHECK_DAYS`].
const RECHECK_SPREAD_DAYS: i32 = 2;
/// A claimed check or import is held this long, so a replica that dies
/// mid-way leaves it due again.
const CLAIM_HOLD_MINUTES: i32 = 5;

/// A picture's settled answer, as `whatsapp_profile_picture.state` spells it.
#[derive(Clone, Copy, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
enum Settled {
    Hidden,
    #[strum(serialize = "none")]
    NotSet,
}

/// Start tracking a person's picture as the chat owner's account sees it,
/// by `preferred` (one of their `aliases`), unless it is already tracked by
/// any of their aliases: one person is queried once.
pub(super) async fn track_person_in(
    tx: &mut Transaction<'_, Postgres>,
    owner: &str,
    preferred: &str,
    aliases: &[String],
) -> ExternalChatResult<()> {
    sqlx::query!(
        r#"INSERT INTO whatsapp_profile_picture (account_id, jid, state)
        SELECT a.id, $2, 'due' FROM whatsapp_linked_account a
        WHERE a.user_id = $1
          AND NOT EXISTS (SELECT 1 FROM whatsapp_profile_picture p WHERE p.account_id = a.id AND p.jid = ANY($3))
        ON CONFLICT (account_id, jid) DO NOTHING"#,
        owner,
        preferred,
        aliases
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    Ok(())
}

/// The account's consent ended (logged out, disconnected, relinked perhaps
/// to another number): what it saw is no longer what the next consent sees,
/// so stored pictures are dropped (their files released) and every tracked
/// picture is checked again once an account connects.
pub(super) async fn recheck_pictures_in(
    tx: &mut Transaction<'_, Postgres>,
    account: Uuid,
) -> ExternalChatResult<()> {
    sqlx::query!(
        r#"UPDATE whatsapp_profile_picture SET state = 'due', picture_id = NULL, static_file_id = NULL,
            staged = NULL, mime = NULL, attempts = 0, retry_at = now()
        WHERE account_id = $1"#,
        account
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    Ok(())
}

/// Start tracking the pictures of these groups or direct chats as the chat
/// owner's account sees them (chats show what their owner's account sees);
/// already tracked ones are left alone.
pub(super) async fn track_pictures_in(
    tx: &mut Transaction<'_, Postgres>,
    owner: &str,
    jids: &[String],
) -> ExternalChatResult<()> {
    sqlx::query!(
        r#"INSERT INTO whatsapp_profile_picture (account_id, jid, state)
        SELECT a.id, jid, 'due' FROM whatsapp_linked_account a, unnest($2::text[]) AS jid
        WHERE a.user_id = $1
        ON CONFLICT (account_id, jid) DO NOTHING"#,
        owner,
        jids
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    Ok(())
}

/// The owner detached this chat: stop tracking (and release the files of)
/// its own picture and its people's, for the owner's account, except those
/// another of the owner's added chats still shows. Re-adding a chat makes a
/// new chat that tracks them again.
pub(super) async fn release_detached_pictures_in(
    tx: &mut Transaction<'_, Postgres>,
    chat: Uuid,
) -> ExternalChatResult<()> {
    let Some(detached) = sqlx::query!(
        r#"SELECT d.user_id, array_append(
            ARRAY(SELECT x.jid FROM whatsapp_identity_alias x WHERE x.chat_id = d.id), d.remote_id) AS "jids!"
        FROM external_chat d WHERE d.id = $1 AND d.state = 'detached'"#,
        chat
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(failure)?
    else {
        return Ok(());
    };
    // Serializes one owner's detaches: two chats sharing a person, detached
    // at once, would each still see the other as added and both keep the row.
    sqlx::query!(
        "SELECT pg_advisory_xact_lock(hashtextextended('whatsapp-pictures-detach:' || $1, 0))",
        detached.user_id
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    sqlx::query!(
        r#"DELETE FROM whatsapp_profile_picture p
        WHERE p.account_id IN (SELECT a.id FROM whatsapp_linked_account a WHERE a.user_id = $1)
          AND p.jid = ANY($2)
          AND NOT EXISTS (
            SELECT 1 FROM external_chat c
            WHERE c.user_id = $1 AND c.provider = 'whatsapp' AND c.state <> 'detached'
              AND (c.remote_id = p.jid
                OR EXISTS (SELECT 1 FROM whatsapp_identity_alias y WHERE y.chat_id = c.id AND y.jid = p.jid)))"#,
        detached.user_id,
        &detached.jids
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    Ok(())
}

/// Tell the owner's chats that show this person or group that its picture
/// changed.
async fn notify_picture_chats_in(
    tx: &mut Transaction<'_, Postgres>,
    user_id: &str,
    jids: &[String],
) -> ExternalChatResult<()> {
    let chats = sqlx::query_scalar!(
        r#"SELECT c.id FROM external_chat c
        WHERE c.user_id = $1 AND c.provider = 'whatsapp' AND c.state <> 'detached'
          AND (c.remote_id = ANY($2)
            OR EXISTS (SELECT 1 FROM whatsapp_identity_alias a WHERE a.chat_id = c.id AND a.jid = ANY($2)))"#,
        user_id,
        jids
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(failure)?;
    for chat_id in chats {
        notify_change(tx, Change::Chat { chat_id }).await?;
    }
    Ok(())
}

pub(super) async fn claim_picture_checks_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    limit: i64,
) -> ExternalChatResult<Vec<PictureCheck>> {
    // Serializes claims of one account, so two can't spend the same budget,
    // without blocking the account's other writes.
    sqlx::query!(
        "SELECT pg_advisory_xact_lock(hashtextextended('whatsapp-pictures:' || $1::uuid::text, 0))",
        account.id
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    sqlx::query!(
        "DELETE FROM whatsapp_picture_query WHERE account_id = $1 AND queried_at <= now() - interval '1 day'",
        account.id
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    let used = sqlx::query!(
        r#"SELECT count(*) FILTER (WHERE queried_at > now() - interval '1 hour') AS "hour!",
            count(*) AS "day!"
        FROM whatsapp_picture_query WHERE account_id = $1"#,
        account.id
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(failure)?;
    let allowed = limit
        .min(PICTURE_QUERIES_PER_HOUR - used.hour)
        .min(PICTURE_QUERIES_PER_DAY - used.day);
    if allowed <= 0 {
        return Ok(vec![]);
    }

    // The existing id is only offered for a ready picture, whose id is the
    // stored file's, so "unchanged" always means the stored file is current
    // (a staged id that never got stored is not offered). A person's common
    // group is one of the owner's added groups they are in, probed per group
    // through the alias key (there is no jid-only alias index).
    let rows = sqlx::query!(
        r#"UPDATE whatsapp_profile_picture p SET retry_at = now() + make_interval(mins => $4)
        WHERE p.account_id = $1 AND p.jid IN (
            SELECT jid FROM whatsapp_profile_picture
            WHERE account_id = $1 AND state <> 'staged' AND retry_at <= now()
            ORDER BY retry_at LIMIT $2 FOR UPDATE SKIP LOCKED)
        RETURNING p.jid, p.retry_at AS claim,
            CASE WHEN p.state = 'ready' THEN p.picture_id END AS existing_id,
            CASE WHEN p.jid NOT LIKE '%@g.us' THEN (
                SELECT c.remote_id FROM external_chat c
                CROSS JOIN LATERAL (
                    SELECT 1 FROM whatsapp_identity_alias a WHERE a.chat_id = c.id AND a.jid = p.jid LIMIT 1
                ) member
                WHERE c.user_id = $3 AND c.provider = 'whatsapp' AND c.kind = 'group' AND c.state <> 'detached'
                LIMIT 1) END AS common_group"#,
        account.id,
        allowed,
        account.user_id,
        CLAIM_HOLD_MINUTES
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(failure)?;
    sqlx::query!(
        "INSERT INTO whatsapp_picture_query (account_id, queried_at) SELECT $1, now() FROM unnest($2::text[])",
        account.id,
        &rows.iter().map(|row| row.jid.clone()).collect::<Vec<_>>()
    )
    .execute(&mut **tx)
    .await
    .map_err(failure)?;
    Ok(rows
        .into_iter()
        .map(|row| PictureCheck {
            jid: row.jid,
            existing_id: row.existing_id,
            common_group: row.common_group,
            claim: row.claim,
        })
        .collect())
}

pub(super) async fn complete_picture_check_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    check: &PictureCheck,
    answer: &PictureAnswer,
) -> ExternalChatResult<()> {
    // Every change to a row in between (a removal, another picture, consent
    // ending, a newer claim) moves its retry time, so a row still at the
    // claim's time is the one this answer is about.
    let jid = check.jid.as_str();
    let Some(stored) = sqlx::query_scalar!(
        "SELECT static_file_id FROM whatsapp_profile_picture WHERE account_id = $1 AND jid = $2 AND state <> 'staged' AND retry_at = $3 FOR UPDATE",
        account.id,
        jid,
        check.claim
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(failure)?
    else {
        return Ok(());
    };

    match answer {
        PictureAnswer::Unchanged => {
            sqlx::query!(
                r#"UPDATE whatsapp_profile_picture SET checked_at = now(), attempts = 0,
                    retry_at = now() + make_interval(days => $3) + random() * make_interval(days => $4)
                WHERE account_id = $1 AND jid = $2"#,
                account.id,
                jid,
                RECHECK_DAYS,
                RECHECK_SPREAD_DAYS
            )
            .execute(&mut **tx)
            .await
            .map_err(failure)?;
        }
        PictureAnswer::Picture { id, bytes, mime } => {
            sqlx::query!(
                r#"UPDATE whatsapp_profile_picture SET state = 'staged', picture_id = $3, staged = $4, mime = $5,
                    checked_at = now(), attempts = 0, retry_at = now()
                WHERE account_id = $1 AND jid = $2"#,
                account.id,
                jid,
                id,
                bytes,
                mime
            )
            .execute(&mut **tx)
            .await
            .map_err(failure)?;
            notify(tx, signals::PICTURE_STAGED, account.id).await?;
        }
        PictureAnswer::Hidden | PictureAnswer::NotSet => {
            let (state, days) = if matches!(answer, PictureAnswer::Hidden) {
                (Settled::Hidden, HIDDEN_RECHECK_DAYS)
            } else {
                (Settled::NotSet, RECHECK_DAYS)
            };
            let state: &'static str = state.into();
            sqlx::query!(
                r#"UPDATE whatsapp_profile_picture SET state = $3, picture_id = NULL, static_file_id = NULL,
                    checked_at = now(), attempts = 0,
                    retry_at = now() + make_interval(days => $4) + random() * make_interval(days => $5)
                WHERE account_id = $1 AND jid = $2"#,
                account.id,
                jid,
                state,
                days,
                RECHECK_SPREAD_DAYS
            )
            .execute(&mut **tx)
            .await
            .map_err(failure)?;
            if stored.is_some() {
                notify_picture_chats_in(tx, &account.user_id, &[jid.to_owned()]).await?;
            }
        }
        PictureAnswer::RateLimited => {
            sqlx::query!(
                "UPDATE whatsapp_profile_picture SET retry_at = now() WHERE account_id = $1 AND jid = $2",
                account.id,
                jid
            )
            .execute(&mut **tx)
            .await
            .map_err(failure)?;
        }
        PictureAnswer::Failed => {
            sqlx::query!(
                r#"UPDATE whatsapp_profile_picture SET attempts = attempts + 1,
                    state = CASE WHEN attempts + 1 >= $3 THEN 'failed' ELSE state END,
                    retry_at = CASE WHEN attempts + 1 >= $3
                        THEN now() + make_interval(days => $4) + random() * make_interval(days => $5)
                        ELSE now() + least(interval '1 minute' * power(2, attempts), interval '1 day') END
                WHERE account_id = $1 AND jid = $2"#,
                account.id,
                jid,
                MAX_PICTURE_ATTEMPTS,
                RECHECK_DAYS,
                RECHECK_SPREAD_DAYS
            )
            .execute(&mut **tx)
            .await
            .map_err(failure)?;
        }
    }
    Ok(())
}

pub(super) async fn picture_changed_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    jids: &[String],
    picture_id: Option<&str>,
) -> ExternalChatResult<()> {
    match picture_id {
        // Removed: drop what is stored. Staged bytes are dropped too, so a
        // DSS import in flight finds the row moved on.
        None => {
            let dropped = sqlx::query_scalar!(
                r#"WITH old AS (
                    SELECT jid, static_file_id FROM whatsapp_profile_picture
                    WHERE account_id = $1 AND jid = ANY($2) FOR UPDATE)
                UPDATE whatsapp_profile_picture p SET state = 'none', picture_id = NULL, static_file_id = NULL,
                    staged = NULL, mime = NULL, checked_at = now(), attempts = 0,
                    retry_at = now() + make_interval(days => $3) + random() * make_interval(days => $4)
                FROM old WHERE p.account_id = $1 AND p.jid = old.jid
                RETURNING old.static_file_id IS NOT NULL AS "had_file!""#,
                account.id,
                jids,
                RECHECK_DAYS,
                RECHECK_SPREAD_DAYS
            )
            .fetch_all(&mut **tx)
            .await
            .map_err(failure)?;
            if dropped.into_iter().any(|had_file| had_file) {
                notify_picture_chats_in(tx, &account.user_id, jids).await?;
            }
        }
        // Another picture: check now. Staged bytes of an older picture are
        // dropped so they are never stored over the new one.
        Some(picture_id) => {
            sqlx::query!(
                r#"UPDATE whatsapp_profile_picture SET
                    state = CASE WHEN state = 'staged' THEN 'due' ELSE state END,
                    staged = NULL, mime = NULL, attempts = 0, retry_at = now()
                WHERE account_id = $1 AND jid = ANY($2) AND picture_id IS DISTINCT FROM $3"#,
                account.id,
                jids,
                picture_id
            )
            .execute(&mut **tx)
            .await
            .map_err(failure)?;
        }
    }
    Ok(())
}

#[async_trait]
impl PictureRepository for PgWhatsAppRepository {
    async fn staged_pictures(&self, limit: i64) -> ExternalChatResult<Vec<StagedPicture>> {
        // Held so DSS replicas don't import the same picture twice.
        let rows = sqlx::query!(
            r#"UPDATE whatsapp_profile_picture p SET retry_at = now() + make_interval(mins => $2)
            FROM whatsapp_linked_account a
            WHERE a.id = p.account_id AND (p.account_id, p.jid) IN (
                SELECT account_id, jid FROM whatsapp_profile_picture
                WHERE state = 'staged' AND retry_at <= now()
                ORDER BY retry_at LIMIT $1 FOR UPDATE SKIP LOCKED)
            RETURNING p.account_id, a.user_id, p.jid, p.picture_id AS "picture_id!",
                p.staged AS "staged!", p.mime AS "mime!""#,
            limit,
            CLAIM_HOLD_MINUTES
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)?;
        Ok(rows
            .into_iter()
            .map(|row| StagedPicture {
                account_id: row.account_id,
                user_id: row.user_id,
                jid: row.jid,
                picture_id: row.picture_id,
                bytes: row.staged,
                mime: row.mime,
            })
            .collect())
    }

    async fn picture_stored(
        &self,
        account: Uuid,
        jid: &str,
        picture_id: &str,
        static_file_id: Uuid,
    ) -> ExternalChatResult<bool> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let owner = sqlx::query_scalar!(
            r#"UPDATE whatsapp_profile_picture p SET state = 'ready', static_file_id = $4, staged = NULL, mime = NULL,
                attempts = 0, retry_at = now() + make_interval(days => $5) + random() * make_interval(days => $6)
            FROM whatsapp_linked_account a
            WHERE a.id = p.account_id AND p.account_id = $1 AND p.jid = $2 AND p.picture_id = $3
                AND (p.state = 'staged' OR (p.state = 'ready' AND p.static_file_id = $4))
            RETURNING a.user_id"#,
            account,
            jid,
            picture_id,
            static_file_id,
            RECHECK_DAYS,
            RECHECK_SPREAD_DAYS
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(failure)?;
        let Some(owner) = owner else {
            sqlx::query!(
                "INSERT INTO external_chat_file_deletion (file_id) VALUES ($1) ON CONFLICT DO NOTHING",
                static_file_id
            )
            .execute(&mut *tx)
            .await
            .map_err(failure)?;
            tx.commit().await.map_err(failure)?;
            return Ok(false);
        };
        notify_picture_chats_in(&mut tx, &owner, &[jid.to_owned()]).await?;
        tx.commit().await.map_err(failure)?;
        Ok(true)
    }

    async fn picture_store_failed(
        &self,
        account: Uuid,
        jid: &str,
        picture_id: &str,
    ) -> ExternalChatResult<()> {
        // After the last attempt the bytes are dropped; the stored file, if
        // any, stays shown until the next check.
        sqlx::query!(
            r#"UPDATE whatsapp_profile_picture SET attempts = attempts + 1,
                state = CASE WHEN attempts + 1 >= $4 THEN 'failed' ELSE state END,
                staged = CASE WHEN attempts + 1 >= $4 THEN NULL ELSE staged END,
                mime = CASE WHEN attempts + 1 >= $4 THEN NULL ELSE mime END,
                retry_at = CASE WHEN attempts + 1 >= $4
                    THEN now() + make_interval(days => $5) + random() * make_interval(days => $6)
                    ELSE now() + least(interval '1 minute' * power(2, attempts), interval '6 hours') END
            WHERE account_id = $1 AND jid = $2 AND state = 'staged' AND picture_id = $3"#,
            account,
            jid,
            picture_id,
            MAX_PICTURE_ATTEMPTS,
            RECHECK_DAYS,
            RECHECK_SPREAD_DAYS
        )
        .execute(&self.pool)
        .await
        .map_err(failure)?;
        Ok(())
    }
}
