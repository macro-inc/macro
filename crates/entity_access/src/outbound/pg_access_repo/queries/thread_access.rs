//! Query for email thread access level.

#[cfg(test)]
mod test;

use crate::{domain::models::AccessLevel, outbound::pg_access_repo::queries::SourceIds};
#[cfg(feature = "explain_binary")]
use crate::{
    domain::models::{AccessGrant, TeamRole},
    outbound::pg_access_repo::queries::list_entity_access_grants,
};
#[cfg(feature = "explain_binary")]
use macro_user_id::user_id::MacroUserIdStr;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
#[cfg(feature = "explain_binary")]
use model_entity::EntityType;
use sqlx::PgPool;
use std::str::FromStr;
use uuid::Uuid;

#[derive(sqlx::FromRow)]
struct OwnedEmailThreadRow {
    id: Uuid,
}

/// Return the requested threads owned by, or inbox-delegated to, `user_id`.
#[allow(
    clippy::disallowed_methods,
    reason = "runtime query is covered by the repository integration test"
)]
pub async fn get_owned_email_thread_ids(
    pool: &PgPool,
    thread_ids: &[Uuid],
    user_id: &MacroUserId<Lowercase<'_>>,
) -> Result<Vec<Uuid>, sqlx::Error> {
    let rows = sqlx::query_as::<_, OwnedEmailThreadRow>(
        r#"
        SELECT t.id
        FROM email_threads t
        JOIN email_links l ON l.id = t.link_id
        WHERE t.id = ANY($1)
          AND (
              l.macro_id = $2
              OR EXISTS (
                  SELECT 1
                  FROM macro_user_links mul
                  WHERE mul.link_id = l.id
                    AND mul.primary_macro_id = $2
              )
          )
        "#,
    )
    .bind(thread_ids)
    .bind(user_id.as_ref())
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|row| row.id).collect())
}

/// Get the highest access level a user has for an email thread.
#[tracing::instrument(err, skip(pool, source_ids))]
pub async fn get_thread_access(
    pool: &PgPool,
    thread_id: &Uuid,
    source_ids: &SourceIds,
    user_id: Option<&MacroUserId<Lowercase<'_>>>,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    let user_id_str = user_id.map(AsRef::as_ref).unwrap_or("");

    // Thread-specific: the caller owns the thread's inbox, or a macro_user_links
    // edge delegates that inbox to the caller (the caller is its primary).
    let is_owner = sqlx::query_scalar!(
        r#"
            SELECT EXISTS (
                SELECT 1
                FROM public.email_threads t
                JOIN public.email_links l ON l.id = t.link_id
                WHERE t.id = $1::uuid
                  AND (
                      l.macro_id = $2
                      OR EXISTS (
                          SELECT 1
                          FROM public.macro_user_links mul
                          WHERE mul.link_id = l.id
                            AND mul.primary_macro_id = $2
                      )
                  )
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
                "linkShareAccessLevel" as "access_level!: AccessLevel"
            FROM "SharePermission"
            WHERE "linkShare" = 'PUBLIC'
            AND "linkShareAccessLevel" IS NOT NULL
            AND id IN (
                SELECT "sharePermissionId" FROM "EmailThreadPermission" WHERE "threadId" = $1
            )

            "#,
            &thread_id.to_string()
        )
        .fetch_optional(pool)
        .await?;

        return Ok(access_level);
    }

    // Owner is handled above and short-circuits. The remaining sources —
    // share-permission/entity_access (including View via the thread's
    // containing project) and team-CRM — can only grant access, so run them
    // concurrently and take the highest level across both.
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
            -- Source 2: item share permission
            SELECT
                sp."linkShareAccessLevel"::text AS access_level
            FROM "SharePermission" sp
            WHERE sp."linkShareAccessLevel" IS NOT NULL
            AND (
                sp."linkShare" = 'PUBLIC'
                OR (
                    sp."linkShare" = 'TEAM'
                    AND EXISTS (
                        SELECT 1
                        FROM email_threads t
                        JOIN email_links l ON l.id = t.link_id
                        JOIN team_user owner_tu ON owner_tu.user_id = l.macro_id
                        WHERE t.id = $1::uuid
                          AND owner_tu.team_id::text = ANY($2)
                    )
                )
            )
            AND sp.id IN (
                SELECT "sharePermissionId" FROM "EmailThreadPermission" WHERE "threadId" = $3
            )

            UNION ALL
            -- Source 3: access to the thread's containing project grants View
            SELECT 'view' AS access_level
            FROM email_threads t
            JOIN entity_access pea ON pea.entity_id::text = t.project_id
                AND pea.entity_type = 'project'
                AND pea.source_id = ANY($2)
            WHERE t.id = $1::uuid
        ) AS combined_access
        "#,
        thread_id,
        &source_ids.0,
        &thread_id_str
    )
    .fetch_all(pool);

    // Team CRM access: a teammate of the thread owner gets Comment access when
    // they share a CRM-enabled team with the owner, the thread has at least
    // one external participant, and no external participant carries an
    // opt-out signal on that team.
    //
    // Opt-out signals are role-aware:
    //   * email_sync=false on a tracked company is a HARD opt-out — the
    //     team explicitly suppressed CRM email sync for that company, and
    //     no role (member, admin, or owner) can see threads through CRM
    //     grant for participants tracked there.
    //   * contact.hidden or company.hidden is a SOFT opt-out — admins and
    //     owners see hidden CRM rows; only plain members are blocked.
    //
    // Untracked external addresses default to allowed.
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
            SELECT tcs.team_id, requester.team_role
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
            -- requester's own email domain). A purely-internal thread
            -- shouldn't grant CRM access.
            WHERE EXISTS (
                SELECT 1
                FROM participants p
                WHERE split_part(p.email, '@', 2) <> split_part(LOWER($2), '@', 2)
            )
              AND NOT EXISTS (
                  -- An external participant flagged for opt-out on this
                  -- team. email_sync=false blocks everyone; hidden flags
                  -- only block plain members.
                  SELECT 1
                  FROM participants p
                  JOIN crm_contacts ct ON ct.email = p.email
                  JOIN crm_companies c ON c.id = ct.company_id
                  WHERE c.team_id = st.team_id
                    AND split_part(p.email, '@', 2) <> split_part(LOWER($2), '@', 2)
                    AND (
                        NOT c.email_sync
                        OR (
                            (ct.hidden OR c.hidden)
                            AND st.team_role = 'member'
                        )
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

#[cfg(feature = "explain_binary")]
#[tracing::instrument(err, skip(pool, source_ids))]
pub async fn explain_thread_access(
    pool: &PgPool,
    thread_id: &Uuid,
    source_ids: &SourceIds,
    user_id: Option<&MacroUserId<Lowercase<'_>>>,
) -> Result<Vec<AccessGrant>, sqlx::Error> {
    let mut grants = Vec::new();
    if let Some(user_id) = user_id {
        grants.extend(explain_thread_inbox(pool, thread_id, user_id).await?);
        grants.extend(explain_thread_crm(pool, thread_id, user_id).await?);
    }

    grants.extend(
        list_entity_access_grants(pool, thread_id, EntityType::EmailThread, source_ids).await?,
    );
    grants.extend(explain_thread_link_shares(pool, thread_id, source_ids).await?);
    if !source_ids.0.is_empty() {
        grants.extend(explain_thread_containing_project(pool, thread_id, source_ids).await?);
    }

    Ok(grants)
}

#[cfg(feature = "explain_binary")]
async fn explain_thread_inbox(
    pool: &PgPool,
    thread_id: &Uuid,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> Result<Vec<AccessGrant>, sqlx::Error> {
    let user_id_str = user_id.as_ref();
    let row = sqlx::query!(
        r#"
        SELECT
            l.macro_id AS "mailbox_owner!",
            (l.macro_id = $2) AS "is_owner!"
        FROM public.email_threads t
        JOIN public.email_links l ON l.id = t.link_id
        WHERE t.id = $1::uuid
          AND (
              l.macro_id = $2
              OR EXISTS (
                  SELECT 1
                  FROM public.macro_user_links mul
                  WHERE mul.link_id = l.id
                    AND mul.primary_macro_id = $2
              )
          )
        "#,
        thread_id,
        user_id_str
    )
    .fetch_optional(pool)
    .await?;

    let Some(row) = row else {
        return Ok(vec![]);
    };

    if row.is_owner {
        Ok(vec![AccessGrant::InboxOwner])
    } else {
        let mailbox_owner = MacroUserIdStr::try_from(row.mailbox_owner)
            .map_err(|error| sqlx::Error::Decode(error.into()))?;
        Ok(vec![AccessGrant::InboxDelegate { mailbox_owner }])
    }
}

#[cfg(feature = "explain_binary")]
async fn explain_thread_link_shares(
    pool: &PgPool,
    thread_id: &Uuid,
    source_ids: &SourceIds,
) -> Result<Vec<AccessGrant>, sqlx::Error> {
    let thread_id_str = thread_id.to_string();
    let mut grants = Vec::new();

    let public_levels = sqlx::query_scalar!(
        r#"
        SELECT
            "linkShareAccessLevel" AS "access_level!: AccessLevel"
        FROM "SharePermission"
        WHERE "linkShare" = 'PUBLIC'
          AND "linkShareAccessLevel" IS NOT NULL
          AND id IN (
              SELECT "sharePermissionId" FROM "EmailThreadPermission" WHERE "threadId" = $1
          )
        "#,
        &thread_id_str
    )
    .fetch_all(pool)
    .await?;
    grants.extend(
        public_levels
            .into_iter()
            .map(|access_level| AccessGrant::PublicLink { access_level }),
    );

    if source_ids.0.is_empty() {
        return Ok(grants);
    }

    let team_rows = sqlx::query!(
        r#"
        SELECT
            sp."linkShareAccessLevel" AS "access_level!: AccessLevel",
            owner_tu.team_id AS "owner_team_id!"
        FROM "SharePermission" sp
        JOIN team_user owner_tu
          ON owner_tu.team_id::text = ANY($2)
        WHERE sp."linkShareAccessLevel" IS NOT NULL
          AND sp."linkShare" = 'TEAM'
          AND sp.id IN (
              SELECT "sharePermissionId" FROM "EmailThreadPermission" WHERE "threadId" = $1
          )
          AND EXISTS (
              SELECT 1
              FROM email_threads t
              JOIN email_links l ON l.id = t.link_id
              WHERE t.id = $3::uuid
                AND owner_tu.user_id = l.macro_id
          )
        "#,
        &thread_id_str,
        &source_ids.0,
        thread_id,
    )
    .fetch_all(pool)
    .await?;
    grants.extend(team_rows.into_iter().map(|row| AccessGrant::TeamLink {
        access_level: row.access_level,
        owner_team_id: row.owner_team_id,
    }));

    Ok(grants)
}

#[cfg(feature = "explain_binary")]
async fn explain_thread_containing_project(
    pool: &PgPool,
    thread_id: &Uuid,
    source_ids: &SourceIds,
) -> Result<Vec<AccessGrant>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"
        SELECT DISTINCT pea.entity_id::text AS "project_id!"
        FROM email_threads t
        JOIN entity_access pea
          ON pea.entity_id::text = t.project_id
         AND pea.entity_type = 'project'
         AND pea.source_id = ANY($2)
        WHERE t.id = $1::uuid
        "#,
        thread_id,
        &source_ids.0,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| AccessGrant::ContainingProject {
            project_id: row.project_id,
        })
        .collect())
}

#[cfg(feature = "explain_binary")]
async fn explain_thread_crm(
    pool: &PgPool,
    thread_id: &Uuid,
    user_id: &MacroUserId<Lowercase<'_>>,
) -> Result<Vec<AccessGrant>, sqlx::Error> {
    let user_id_str = user_id.as_ref();
    let rows = sqlx::query!(
        r#"
        WITH thread_owner AS (
            SELECT el.macro_id
            FROM email_threads t
            JOIN email_links el ON el.id = t.link_id
            WHERE t.id = $1::uuid
        ),
        shared_teams AS (
            SELECT tcs.team_id, requester.team_role
            FROM team_user requester
            JOIN team_user owner_member ON owner_member.team_id = requester.team_id
            JOIN thread_owner o ON o.macro_id = owner_member.user_id
            JOIN team_crm_settings tcs ON tcs.team_id = requester.team_id
            WHERE requester.user_id = $2
              AND tcs.crm_enabled
        ),
        participants AS (
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
        SELECT st.team_id, st.team_role AS "team_role!: TeamRole"
        FROM shared_teams st
        WHERE EXISTS (
            SELECT 1
            FROM participants p
            WHERE split_part(p.email, '@', 2) <> split_part(LOWER($2), '@', 2)
        )
          AND NOT EXISTS (
              SELECT 1
              FROM participants p
              JOIN crm_contacts ct ON ct.email = p.email
              JOIN crm_companies c ON c.id = ct.company_id
              WHERE c.team_id = st.team_id
                AND split_part(p.email, '@', 2) <> split_part(LOWER($2), '@', 2)
                AND (
                    NOT c.email_sync
                    OR (
                        (ct.hidden OR c.hidden)
                        AND st.team_role = 'member'
                    )
                )
          )
        "#,
        thread_id,
        user_id_str
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| AccessGrant::CrmTeam {
            team_id: row.team_id,
            team_role: row.team_role,
            access_level: AccessLevel::Comment,
        })
        .collect())
}
