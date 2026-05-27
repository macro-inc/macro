//! Query for email thread access level.

#[cfg(test)]
mod test;

use crate::{domain::models::AccessLevel, outbound::pg_access_repo::queries::SourceIds};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::PgPool;
use std::str::FromStr;
use uuid::Uuid;

/// Get the highest access level a user has for an email thread.
#[tracing::instrument(err, skip(pool, source_ids))]
pub async fn get_thread_access(
    pool: &PgPool,
    thread_id: &Uuid,
    source_ids: &SourceIds,
    user_id: Option<&MacroUserId<Lowercase<'_>>>,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    let user_id_str = user_id.map(AsRef::as_ref).unwrap_or("");

    // Thread-specific: check if user is the thread owner via email_links
    let is_owner = sqlx::query_scalar!(
        r#"
            SELECT EXISTS (
                SELECT 1
                FROM public.email_threads t
                JOIN public.email_links l ON l.id = t.link_id
                WHERE t.id = $1::uuid
                  AND l.macro_id = $2
            ) AS "exists!"
            "#,
        thread_id,
        user_id_str
    )
    .fetch_one(pool)
    .await?;

    if is_owner {
        return Ok(Some(AccessLevel::Owner));
    }

    // Check share permission access only
    if source_ids.0.is_empty() {
        let access_level = sqlx::query_scalar!(
            r#"
            SELECT
                "publicAccessLevel" as "access_level!"
            FROM "SharePermission"
            WHERE "isPublic" = true
            AND "publicAccessLevel" IS NOT NULL
            AND id IN (
                SELECT "sharePermissionId" FROM "EmailThreadPermission" WHERE "threadId" = $1
            )

            "#,
            &thread_id.to_string()
        )
        .fetch_optional(pool)
        .await?;

        return Ok(access_level.and_then(|level| AccessLevel::from_str(&level).ok()));
    }

    // Owner is handled above and short-circuits. The remaining two sources —
    // share-permission/entity_access and team-CRM — can only grant access, so
    // run them concurrently and take the highest level across both.
    let thread_id_str = thread_id.to_string();

    let share_fut = sqlx::query_scalar!(
        r#"
        SELECT access_level FROM (
            -- Source 1: entity_access source_id match
            SELECT
                access_level::text FROM entity_access
            WHERE entity_id = $1
            AND entity_type = 'email_thread'
            AND source_id = ANY($2)

            UNION ALL
            -- Source 2: items share permission
            SELECT
                "publicAccessLevel"::text AS access_level
            FROM "SharePermission"
            WHERE "isPublic" = true
            AND "publicAccessLevel" IS NOT NULL
            AND id IN (
                SELECT "sharePermissionId" FROM "EmailThreadPermission" WHERE "threadId" = $3
            )
        ) AS combined_access
        "#,
        thread_id,
        &source_ids.0,
        &thread_id_str
    )
    .fetch_all(pool);

    // Team CRM access: a teammate of the thread owner gets Comment access when
    // they share a CRM-enabled team with the owner AND every participant
    // (from/to/cc/bcc) resolves to a non-hidden crm_contacts row whose
    // non-hidden crm_companies row has email_sync on. Strict: any participant
    // without a qualifying contact in that team denies access.
    let crm_fut = sqlx::query_scalar!(
        r#"
        WITH thread_owner AS (
            SELECT el.macro_id
            FROM email_threads t
            JOIN email_links el ON el.id = t.link_id
            WHERE t.id = $1::uuid
        ),
        shared_teams AS (
            -- Teams the requester shares with the owner that have CRM enabled.
            SELECT tcs.team_id
            FROM team_user requester
            JOIN team_user owner_member ON owner_member.team_id = requester.team_id
            JOIN thread_owner o ON o.macro_id = owner_member.user_id
            JOIN team_crm_settings tcs ON tcs.team_id = requester.team_id
            WHERE requester.user_id = $2
              AND tcs.crm_enabled
        ),
        participants AS (
            -- Distinct addresses across from + to/cc/bcc on the thread.
            SELECT DISTINCT LOWER(ec.email_address) AS email
            FROM email_messages m
            JOIN email_contacts ec ON ec.id = m.from_contact_id
            WHERE m.thread_id = $1::uuid
            UNION
            SELECT DISTINCT LOWER(ec.email_address)
            FROM email_messages m
            JOIN email_message_recipients r ON r.message_id = m.id
            JOIN email_contacts ec ON ec.id = r.contact_id
            WHERE m.thread_id = $1::uuid
        )
        SELECT EXISTS (
            SELECT 1
            FROM shared_teams st
            -- Require at least one *external* participant (outside the
            -- requester's own email domain). Internal colleagues don't
            -- need to be tracked CRM contacts, but a purely-internal
            -- thread shouldn't grant CRM access either.
            WHERE EXISTS (
                SELECT 1
                FROM participants p
                WHERE split_part(p.email, '@', 2) <> split_part(LOWER($2), '@', 2)
            )
              AND NOT EXISTS (
                  -- An external participant with no qualifying contact in
                  -- this team. Participants on the requester's own domain
                  -- are skipped (they're internal, not CRM contacts).
                  SELECT 1
                  FROM participants p
                  WHERE split_part(p.email, '@', 2) <> split_part(LOWER($2), '@', 2)
                    AND NOT EXISTS (
                      SELECT 1
                      FROM crm_contacts ct
                      JOIN crm_companies c ON c.id = ct.company_id
                      WHERE c.team_id = st.team_id
                        AND ct.email = p.email
                        AND c.email_sync
                        AND NOT c.hidden
                        AND NOT ct.hidden
                  )
              )
        ) AS "granted!"
        "#,
        thread_id,
        user_id_str
    )
    .fetch_one(pool);

    let (share_rows, crm_granted) = tokio::join!(share_fut, crm_fut);

    let highest_level = share_rows?
        .iter()
        .filter_map(|opt| opt.as_ref().and_then(|s| AccessLevel::from_str(s).ok()))
        .max();

    let crm_level = crm_granted?.then_some(AccessLevel::Comment);

    Ok([highest_level, crm_level].into_iter().flatten().max())
}
