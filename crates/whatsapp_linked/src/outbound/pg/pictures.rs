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

/// Start tracking the pictures of these people or groups as the chat
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

    // A claimed check is held for five minutes, so a replica that dies
    // mid-check leaves it due again. The existing id is only offered when the
    // picture is stored, so "unchanged" always means a stored file is current.
    // A person's common group is one of the owner's added groups they are in.
    let rows = sqlx::query!(
        r#"UPDATE whatsapp_profile_picture p SET retry_at = now() + interval '5 minutes'
        WHERE p.account_id = $1 AND p.jid IN (
            SELECT jid FROM whatsapp_profile_picture
            WHERE account_id = $1 AND state <> 'staged' AND retry_at <= now()
            ORDER BY retry_at LIMIT $2 FOR UPDATE SKIP LOCKED)
        RETURNING p.jid,
            CASE WHEN p.static_file_id IS NOT NULL THEN p.picture_id END AS existing_id,
            CASE WHEN p.jid NOT LIKE '%@g.us' THEN (
                SELECT c.remote_id FROM external_chat c
                WHERE c.user_id = $3 AND c.provider = 'whatsapp' AND c.kind = 'group' AND c.state <> 'detached'
                  AND EXISTS (SELECT 1 FROM whatsapp_identity_alias a WHERE a.chat_id = c.id AND a.jid = p.jid)
                LIMIT 1) END AS common_group"#,
        account.id,
        allowed,
        account.user_id
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
        })
        .collect())
}

pub(super) async fn complete_picture_check_in(
    tx: &mut Transaction<'_, Postgres>,
    account: &Fenced,
    jid: &str,
    answer: &PictureAnswer,
) -> ExternalChatResult<()> {
    let Some(stored) = sqlx::query_scalar!(
        "SELECT static_file_id FROM whatsapp_profile_picture WHERE account_id = $1 AND jid = $2 AND state <> 'staged' FOR UPDATE",
        account.id,
        jid
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(failure)?
    else {
        return Ok(());
    };

    // Settled answers are checked again in about a week (two for hidden,
    // which rarely flips), spread over two days so checks don't bunch up.
    match answer {
        PictureAnswer::Unchanged => {
            sqlx::query!(
                r#"UPDATE whatsapp_profile_picture SET
                    state = CASE WHEN static_file_id IS NOT NULL THEN 'ready' ELSE 'due' END,
                    checked_at = now(), attempts = 0,
                    retry_at = now() + interval '6 days' + random() * interval '2 days'
                WHERE account_id = $1 AND jid = $2"#,
                account.id,
                jid
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
            let (state, days) = match answer {
                PictureAnswer::Hidden => ("hidden", 13),
                _ => ("none", 6),
            };
            sqlx::query!(
                r#"UPDATE whatsapp_profile_picture SET state = $3, picture_id = NULL, static_file_id = NULL,
                    checked_at = now(), attempts = 0,
                    retry_at = now() + make_interval(days => $4) + random() * interval '2 days'
                WHERE account_id = $1 AND jid = $2"#,
                account.id,
                jid,
                state,
                days
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
                        THEN now() + interval '6 days' + random() * interval '2 days'
                        ELSE now() + least(interval '1 minute' * power(2, attempts), interval '1 day') END
                WHERE account_id = $1 AND jid = $2"#,
                account.id,
                jid,
                MAX_PICTURE_ATTEMPTS
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
                    retry_at = now() + interval '6 days' + random() * interval '2 days'
                FROM old WHERE p.account_id = $1 AND p.jid = old.jid
                RETURNING old.static_file_id IS NOT NULL AS "had_file!""#,
                account.id,
                jids
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
        // Held for five minutes so DSS replicas don't import the same picture
        // twice; a replica that dies leaves it due again.
        let rows = sqlx::query!(
            r#"UPDATE whatsapp_profile_picture p SET retry_at = now() + interval '5 minutes'
            FROM whatsapp_linked_account a
            WHERE a.id = p.account_id AND (p.account_id, p.jid) IN (
                SELECT account_id, jid FROM whatsapp_profile_picture
                WHERE state = 'staged' AND retry_at <= now()
                ORDER BY retry_at LIMIT $1 FOR UPDATE SKIP LOCKED)
            RETURNING p.account_id, a.user_id, p.jid, p.picture_id AS "picture_id!",
                p.staged AS "staged!", p.mime AS "mime!""#,
            limit
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
                attempts = 0, retry_at = now() + interval '6 days' + random() * interval '2 days'
            FROM whatsapp_linked_account a
            WHERE a.id = p.account_id AND p.account_id = $1 AND p.jid = $2 AND p.state = 'staged' AND p.picture_id = $3
            RETURNING a.user_id"#,
            account,
            jid,
            picture_id,
            static_file_id
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
                    THEN now() + interval '6 days' + random() * interval '2 days'
                    ELSE now() + least(interval '1 minute' * power(2, attempts), interval '6 hours') END
            WHERE account_id = $1 AND jid = $2 AND state = 'staged' AND picture_id = $3"#,
            account,
            jid,
            picture_id,
            MAX_PICTURE_ATTEMPTS
        )
        .execute(&self.pool)
        .await
        .map_err(failure)?;
        Ok(())
    }
}
