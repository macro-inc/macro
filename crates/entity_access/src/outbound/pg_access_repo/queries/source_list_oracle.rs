//! The access statements as they were when they bound the viewer's whole
//! source list, kept as the oracle for the membership form.
//!
//! The functions below are main's at 37d49af5c4, copied verbatim except that
//! their visibility is narrowed, their tracing and cache attributes are
//! dropped, and the helper they share (`database_access::highest_access_level`)
//! is named by path. Each family's equality test runs them and the membership
//! form for every viewer `test_viewers::matrix_viewers` resolves, and requires
//! the same answers. Delete this module with `external_chat_sources` and
//! `external_chat_access_level(uuid, text[])`, which code deployed before the
//! membership functions still calls.

use crate::domain::models::AccessLevel;
use bot_id::BotIdStr;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::{PgPool, Pool, Postgres};
use std::collections::{BTreeMap, HashMap};
use std::str::FromStr;
use uuid::Uuid;

/// The viewer's whole source list, as the old statements took it.
#[derive(Debug, Clone)]
pub(crate) struct SourceIds(pub Vec<String>);

// ---- queries.rs

/// Grabs the users source ids for the entity access table
/// NOTE: This could return an empty list in the event the user is not logged in and attempting to review a resource
pub(super) async fn get_user_source_ids(
    pool: &Pool<Postgres>,
    user_id: Option<&MacroUserId<Lowercase<'_>>>,
) -> anyhow::Result<SourceIds> {
    if let Some(user_id) = user_id {
        // Fetch source IDs first
        let source_ids = sqlx::query_scalar!(
            r#"
            SELECT cp.channel_id::text FROM comms_channel_participants cp
                WHERE cp.user_id = $1 AND cp.left_at IS NULL
            UNION ALL
            SELECT t.team_id::text FROM team_user t
                WHERE t.user_id = $1
            UNION ALL
            SELECT $1
            "#,
            user_id.as_ref()
        )
        .fetch_all(pool)
        .await?;

        let source_ids: Vec<String> = source_ids.into_iter().flatten().collect();

        Ok(SourceIds(source_ids))
    } else {
        Ok(SourceIds(vec![]))
    }
}

/// Grabs the source ids available to a bot operating in its owning team's scope.
///
/// A direct agent conversation is not among them, although the persona takes
/// part in it: what is shared there belongs to the person it is with.
pub(super) async fn get_team_scope_source_ids(
    pool: &Pool<Postgres>,
    bot_id: &BotIdStr<'_>,
    team_id: &uuid::Uuid,
) -> anyhow::Result<SourceIds> {
    let source_ids = sqlx::query_scalar!(
        r#"
        WITH active_bot AS (
            SELECT id
            FROM bots
            WHERE id = $2
              AND team_id = $3
              AND deleted_at IS NULL
        )
        SELECT $1::text AS "source_id!"
        FROM active_bot
        UNION
        SELECT $3::text
        FROM active_bot
        UNION
        SELECT c.id::text
        FROM active_bot
        JOIN comms_channels c
          ON c.channel_type = 'team'
         AND c.team_id = $3
        UNION
        SELECT cp.channel_id::text
        FROM active_bot
        JOIN comms_channel_participants cp
          ON cp.user_id = $1
         AND cp.left_at IS NULL
        WHERE NOT EXISTS (
            SELECT 1
            FROM comms_channel_agents ca
            WHERE ca.channel_id = cp.channel_id
              AND ca.kind = 'direct'
        )
        "#,
        bot_id.as_ref(),
        bot_id.as_uuid(),
        team_id,
    )
    .fetch_all(pool)
    .await?;

    Ok(SourceIds(source_ids))
}

// ---- document_access

/// Get the highest access level a user has for a document.
pub(super) async fn get_document_access(
    pool: &PgPool,
    document_id: &uuid::Uuid,
    source_ids: &SourceIds,
    user_id: Option<&MacroUserId<Lowercase<'_>>>,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    // Check share permission access only
    if source_ids.0.is_empty() {
        let access_level = sqlx::query_scalar!(
            r#"
            SELECT
                share_permission."linkShareAccessLevel" AS "access_level!: AccessLevel"
            FROM "SharePermission" share_permission
            JOIN "DocumentPermission" document_permission
              ON document_permission."sharePermissionId" = share_permission.id
            WHERE share_permission."linkShare" = 'PUBLIC'
              AND share_permission."linkShareAccessLevel" IS NOT NULL
              AND document_permission."documentId" = $1
            "#,
            &document_id.to_string()
        )
        .fetch_optional(pool)
        .await?;

        return Ok(access_level);
    }

    // A separate statement on purpose: an owner grant settles the result, and
    // planning the union below costs more than executing it.
    let is_direct_owner = sqlx::query_scalar!(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM entity_access
            WHERE entity_id = $1
              AND entity_type = 'document'
              AND source_id = ANY($2)
              AND access_level = 'owner'
        ) AS "is_direct_owner!"
        "#,
        document_id,
        &source_ids.0,
    )
    .fetch_one(pool)
    .await?;

    if is_direct_owner {
        return Ok(Some(AccessLevel::Owner));
    }

    let user_id_str = user_id.map(AsRef::as_ref).unwrap_or("");

    let all_level_strings: Vec<Option<String>> = sqlx::query_scalar!(
        r#"
        SELECT access_level FROM (
            -- Source 1: entity_access source_id match
            SELECT
                access_level::text FROM entity_access
            WHERE entity_id = $1
            AND entity_type = 'document'
            AND source_id = ANY($2)

            UNION ALL
            -- Source 2: document link share permission
            SELECT
                share_permission."linkShareAccessLevel"::text AS access_level
            FROM "Document" document
            JOIN "DocumentPermission" document_permission
              ON document_permission."documentId" = document.id
            JOIN "SharePermission" share_permission
              ON share_permission.id = document_permission."sharePermissionId"
            WHERE document.id = $3
              AND share_permission."linkShareAccessLevel" IS NOT NULL
              AND (
                  share_permission."linkShare" = 'PUBLIC'
                  OR (
                      share_permission."linkShare" = 'TEAM'
                      AND EXISTS (
                          SELECT 1
                          FROM owner_team(document.owner) owner_team
                          WHERE owner_team.team_id::text = ANY($2)
                      )
                  )
              )

            UNION ALL
            -- Source 3: email-attachment documents inherit access from any
            -- linked thread the caller can reach. Owning or being delegated
            -- the thread's inbox (macro_user_links) grants Edit, mirroring
            -- calendar-event delegation. A thread-level entity_access grant
            -- inherits as View regardless of its level: a SHA-deduped document
            -- can back attachments in other threads with different audiences,
            -- so a per-thread share must not confer write access to it.
            SELECT CASE
                WHEN l.macro_id = $4
                  OR EXISTS (
                      SELECT 1
                      FROM macro_user_links mul
                      WHERE mul.link_id = l.id
                        AND mul.primary_macro_id = $4
                  )
                THEN 'edit'
                ELSE 'view'
            END AS access_level
            FROM document_email de
            JOIN email_attachments ea ON ea.id = de.email_attachment_id
            JOIN email_messages em ON em.id = ea.message_id
            JOIN email_threads t ON t.id = em.thread_id
            JOIN email_links l ON l.id = t.link_id
            WHERE de.document_id = $3
              AND (
                  l.macro_id = $4
                  OR EXISTS (
                      SELECT 1
                      FROM macro_user_links mul
                      WHERE mul.link_id = l.id
                        AND mul.primary_macro_id = $4
                  )
                  OR EXISTS (
                      SELECT 1
                      FROM entity_access thread_access
                      WHERE thread_access.entity_id = t.id
                        AND thread_access.entity_type = 'email_thread'
                        AND thread_access.source_id = ANY($2)
                  )
              )

            UNION ALL
            -- Source 4: a file attached to a document discussion is visible to
            -- current viewers of that document. Removing the attachment, the
            -- discussion, or the parent grant removes this path; it never
            -- shares the parent itself.
            SELECT 'view' AS access_level
            FROM comms_attachments a
            JOIN comms_messages m ON m.id = a.message_id
            JOIN comms_message_threads mt ON mt.root_id = COALESCE(m.thread_id, m.id)
            JOIN "Document" parent_doc
              ON m.parent_entity_type = 'document' AND parent_doc.id = m.parent_entity_id
            LEFT JOIN "DocumentPermission" dp ON dp."documentId" = parent_doc.id
            LEFT JOIN "SharePermission" sp ON sp.id = dp."sharePermissionId"
            WHERE a.entity_type = 'document'
              AND a.entity_id = $3
              AND m.deleted_at IS NULL
              AND mt.deleted_at IS NULL
              AND parent_doc."deletedAt" IS NULL
              AND (
                  parent_doc.owner = $4
                  OR EXISTS (
                      SELECT 1
                      FROM entity_access pa
                      WHERE pa.entity_type = 'document'
                        AND pa.entity_id::text = parent_doc.id
                        AND pa.source_id = ANY($2)
                  )
                  OR (
                      sp."linkShareAccessLevel" IS NOT NULL
                      AND (
                          sp."linkShare" = 'PUBLIC'
                          OR (
                              sp."linkShare" = 'TEAM'
                              AND EXISTS (
                                  SELECT 1
                                  FROM owner_team(parent_doc.owner) tu
                                  WHERE tu.team_id::text = ANY($2)
                              )
                          )
                      )
                  )
              )
        ) AS combined_access
        "#,
        document_id,
        &source_ids.0,
        &document_id.to_string(),
        user_id_str,
    )
    .fetch_all(pool)
    .await?;

    let highest_level = all_level_strings
        .iter()
        .filter_map(|opt| opt.as_ref().and_then(|s| AccessLevel::from_str(s).ok()))
        .max();

    Ok(highest_level)
}

/// Historical document ids are not UUIDs and cannot occur in `entity_access`
/// rows. Their ownership, link grants, channel grants, and project grants still
/// live in the ordinary document and share tables.
pub(super) async fn get_legacy_document_access(
    pool: &PgPool,
    document_id: &str,
    source_ids: &SourceIds,
    user_id: Option<&MacroUserId<Lowercase<'_>>>,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    let levels = sqlx::query_scalar!(
        r#"
        WITH RECURSIVE parent_projects AS (
            SELECT p.id, p."parentId", p."userId"
            FROM "Project" p
            JOIN "Document" d ON d."projectId" = p.id
            WHERE d.id = $1 AND d."deletedAt" IS NULL AND p."deletedAt" IS NULL
            UNION
            SELECT p.id, p."parentId", p."userId"
            FROM "Project" p
            JOIN parent_projects child ON p.id = child."parentId"
            WHERE p."deletedAt" IS NULL
        ), document_permissions AS (
            SELECT d.owner, sp.id, sp."linkShare", sp."linkShareAccessLevel"
            FROM "Document" d
            LEFT JOIN "DocumentPermission" dp ON dp."documentId" = d.id
            LEFT JOIN "SharePermission" sp ON sp.id = dp."sharePermissionId"
            WHERE d.id = $1 AND d."deletedAt" IS NULL
        )
        SELECT 'owner'::text AS "level!" FROM document_permissions WHERE owner = $2
        UNION ALL
        SELECT "linkShareAccessLevel"::text FROM document_permissions p
        WHERE "linkShareAccessLevel" IS NOT NULL
          AND (
              "linkShare" = 'PUBLIC'
              OR (
                  "linkShare" = 'TEAM'
                  AND EXISTS (
                      SELECT 1 FROM owner_team(p.owner) t
                      WHERE t.team_id::text = ANY($3)
                  )
              )
          )
        UNION ALL
        SELECT c.access_level::text FROM document_permissions p
        JOIN "ChannelSharePermission" c ON c.share_permission_id = p.id
        WHERE c.channel_id = ANY($3)
        UNION ALL
        SELECT 'edit'::text FROM parent_projects WHERE "userId" = $2
        UNION ALL
        SELECT a.access_level::text FROM entity_access a
        JOIN parent_projects p ON a.entity_id::text = p.id
        WHERE a.entity_type = 'project' AND a.source_id = ANY($3)
        "#,
        document_id,
        user_id.map(AsRef::as_ref),
        &source_ids.0,
    )
    .fetch_all(pool)
    .await?;
    Ok(levels
        .iter()
        .filter_map(|level| AccessLevel::from_str(level).ok())
        .max())
}

// ---- chat_access

/// Get the highest access level a user has for a chat.
pub(super) async fn get_chat_access(
    pool: &PgPool,
    chat_id: &uuid::Uuid,
    source_ids: &SourceIds,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    // Check share permission access only
    if source_ids.0.is_empty() {
        let access_level = sqlx::query_scalar!(
            r#"
            SELECT
                sp."linkShareAccessLevel" AS "access_level!: AccessLevel"
            FROM "SharePermission" sp
            JOIN "ChatPermission" cp ON cp."sharePermissionId" = sp.id
            WHERE cp."chatId" = $1
              AND sp."linkShare" = 'PUBLIC'
              AND sp."linkShareAccessLevel" IS NOT NULL

            "#,
            &chat_id.to_string()
        )
        .fetch_optional(pool)
        .await?;

        return Ok(access_level);
    }

    let all_level_strings: Vec<Option<String>> = sqlx::query_scalar!(
        r#"
        SELECT access_level FROM (
            -- Source 1: entity_access source_id match
            SELECT
                access_level::text FROM entity_access
            WHERE entity_id = $1
            AND entity_type = 'chat'
            AND source_id = ANY($2)

            UNION ALL
            -- Source 2: chat link share permission
            SELECT
                sp."linkShareAccessLevel"::text AS access_level
            FROM "SharePermission" sp
            JOIN "ChatPermission" cp ON cp."sharePermissionId" = sp.id
            WHERE cp."chatId" = $3
              AND sp."linkShareAccessLevel" IS NOT NULL
              AND (
                  sp."linkShare" = 'PUBLIC'
                  OR (
                      sp."linkShare" = 'TEAM'
                      AND EXISTS (
                          SELECT 1
                          FROM "Chat" c
                          CROSS JOIN owner_team(c."userId") owner_tu
                          WHERE c.id = $3
                            AND owner_tu.team_id::text = ANY($2)
                      )
                  )
              )
        ) AS combined_access
        "#,
        chat_id,
        &source_ids.0,
        &chat_id.to_string()
    )
    .fetch_all(pool)
    .await?;

    let highest_level = all_level_strings
        .iter()
        .filter_map(|opt| opt.as_ref().and_then(|s| AccessLevel::from_str(s).ok()))
        .max();

    Ok(highest_level)
}

// ---- project_access

/// Get the highest access level a user has for a project.
pub(super) async fn get_project_access(
    pool: &PgPool,
    project_id: &uuid::Uuid,
    source_ids: &SourceIds,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    // Check share permission access only
    if source_ids.0.is_empty() {
        let access_level = sqlx::query_scalar!(
            r#"
            SELECT
                sp."linkShareAccessLevel" AS "access_level!: AccessLevel"
            FROM "SharePermission" sp
            WHERE sp."linkShare" = 'PUBLIC'
            AND sp."linkShareAccessLevel" IS NOT NULL
            AND sp.id IN (
                SELECT "sharePermissionId" FROM "ProjectPermission" WHERE "projectId" = $1
            )

            "#,
            &project_id.to_string()
        )
        .fetch_optional(pool)
        .await?;

        return Ok(access_level);
    }

    let all_level_strings: Vec<Option<String>> = sqlx::query_scalar!(
        r#"
        SELECT access_level FROM (
            -- Source 1: entity_access source_id match
            SELECT
                access_level::text FROM entity_access
            WHERE entity_id = $1
            AND entity_type = 'project'
            AND source_id = ANY($2)

            UNION ALL
            -- Source 2: project link share permission
            SELECT
                sp."linkShareAccessLevel"::text AS access_level
            FROM "SharePermission" sp
            WHERE sp."linkShareAccessLevel" IS NOT NULL
            AND sp.id IN (
                SELECT "sharePermissionId" FROM "ProjectPermission" WHERE "projectId" = $3
            )
            AND (
                sp."linkShare" = 'PUBLIC'
                OR (
                    sp."linkShare" = 'TEAM'
                    AND EXISTS (
                        SELECT 1
                        FROM "Project" p
                        CROSS JOIN owner_team(p."userId") owner_team
                        WHERE p.id = $3
                        AND owner_team.team_id::text = ANY($2)
                    )
                )
            )
        ) AS combined_access
        "#,
        project_id,
        &source_ids.0,
        &project_id.to_string()
    )
    .fetch_all(pool)
    .await?;

    let highest_level = all_level_strings
        .iter()
        .filter_map(|opt| opt.as_ref().and_then(|s| AccessLevel::from_str(s).ok()))
        .max();

    Ok(highest_level)
}

// ---- call_access

/// Get the highest access level a user has for a call.
pub(super) async fn get_call_access(
    pool: &PgPool,
    call_id: &uuid::Uuid,
    source_ids: &SourceIds,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    // Check share permission access only
    if source_ids.0.is_empty() {
        let access_level = sqlx::query_scalar!(
            r#"
            SELECT
                share_permission."linkShareAccessLevel" AS "access_level!: AccessLevel"
            FROM "SharePermission" share_permission
            JOIN (
                SELECT share_permission_id FROM call_entities WHERE id = $1
            ) call_item ON call_item.share_permission_id = share_permission.id
            WHERE share_permission."linkShare" = 'PUBLIC'
              AND share_permission."linkShareAccessLevel" IS NOT NULL
            "#,
            call_id,
        )
        .fetch_optional(pool)
        .await?;

        return Ok(access_level);
    }

    let all_level_strings: Vec<Option<String>> = sqlx::query_scalar!(
        r#"
        SELECT access_level FROM (
            -- Source 1: entity_access source_id match
            SELECT
                access_level::text FROM entity_access
            WHERE entity_id = $1
            AND entity_type = 'call'
            AND source_id = ANY($2)

            UNION ALL
            -- Source 2: call link share permission
            SELECT
                share_permission."linkShareAccessLevel"::text AS access_level
            FROM "SharePermission" share_permission
            JOIN (
                SELECT share_permission_id, user_id AS created_by FROM call_entities WHERE id = $1
            ) call_item ON call_item.share_permission_id = share_permission.id
            WHERE share_permission."linkShareAccessLevel" IS NOT NULL
              AND (
                  share_permission."linkShare" = 'PUBLIC'
                  OR (
                      share_permission."linkShare" = 'TEAM'
                      AND EXISTS (
                          SELECT 1
                          FROM team_user owner_team
                          WHERE owner_team.user_id = call_item.created_by
                            AND owner_team.team_id::text = ANY($2)
                      )
                  )
              )
        ) AS combined_access
        "#,
        call_id,
        &source_ids.0,
    )
    .fetch_all(pool)
    .await?;

    let highest_level = all_level_strings
        .iter()
        .filter_map(|opt| opt.as_ref().and_then(|s| AccessLevel::from_str(s).ok()))
        .max();

    Ok(highest_level)
}

// ---- thread_access

/// Get the highest access level a user has for an email thread.
pub(super) async fn get_thread_access(
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
    // they share a team with the owner, that mailbox has explicit consent,
    // the thread has an external participant, and no participant is excluded
    // by the team's or the contributor's domain blocks.
    //
    // Opt-out signals are role-aware:
    //   * email_sync=false on a tracked company is a HARD opt-out — the
    //     team explicitly suppressed CRM email sync for that company, and
    //     no role (member, admin, or owner) can see threads through CRM
    //     grant for participants tracked there.
    //   * contact.hidden or company.hidden is a SOFT opt-out — admins and
    //     owners see hidden CRM rows; only plain members are blocked. A
    //     contact without a company opts out through its own hidden flag.
    //
    // Untracked external addresses remain subject to both domain blocklists.
    let crm_fut = sqlx::query_scalar!(
        r#"
        WITH thread_owner AS (
            SELECT el.macro_id
            FROM email_threads t
            JOIN email_links el ON el.id = t.link_id
            WHERE t.id = $1::uuid
        ),
        shared_teams AS (
            -- Shared teams with an eligible contribution from this mailbox.
            SELECT requester.team_id, requester.team_role
            FROM team_user requester
            JOIN team_user owner_member ON owner_member.team_id = requester.team_id
            JOIN thread_owner o ON o.macro_id = owner_member.user_id
            WHERE requester.user_id = $2
              AND crm_email_thread_allowed(requester.team_id, $1::uuid)
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
                  JOIN crm_contact_emails ce ON ce.email = p.email
                  JOIN crm_contacts ct ON ct.id = ce.contact_id
                  -- Contacts without a company opt out through their own
                  -- hidden flag; email_sync is a company setting.
                  LEFT JOIN crm_companies c ON c.id = ct.company_id
                  WHERE ct.team_id = st.team_id
                    AND split_part(p.email, '@', 2) <> split_part(LOWER($2), '@', 2)
                    AND (
                        NOT COALESCE(c.email_sync, TRUE)
                        OR (
                            (ct.hidden OR COALESCE(c.hidden, FALSE))
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

// ---- agent_session_access

/// List agent sessions granted to the caller's current user/channel/team sources.
/// Optional requested IDs narrow the allowlist before it reaches OpenSearch.
pub(super) async fn accessible_session_ids(
    pool: &PgPool,
    source_ids: &SourceIds,
    requested_ids: &[uuid::Uuid],
) -> Result<Vec<uuid::Uuid>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        SELECT DISTINCT entity_id
        FROM entity_access
        WHERE entity_type = 'agent_session'
          AND source_id = ANY($1)
          AND (cardinality($2::uuid[]) = 0 OR entity_id = ANY($2))
          -- Hidden sessions (thread-started, DM contexts) stay out of search
          -- unless asked for by id. A grant with no session row (tests, a deleted session) is
          -- not hidden: the predicate only matches a hidden row.
          AND (
              entity_id = ANY($2)
              OR NOT EXISTS (
                  SELECT 1 FROM agent_session s
                  WHERE s.id = entity_access.entity_id
                    AND s.visibility = 'hidden'
              )
          )
        "#,
        &source_ids.0,
        requested_ids,
    )
    .fetch_all(pool)
    .await
}

/// Get the highest access level a user has for an agent session.
///
/// A session's grants are written when it is created: the owner with
/// owner, and - when the session was opened by a mention - the channel that
/// mention was posted in, as editor, or as viewer when the bot is a user's
/// private agent. Channel membership is not copied into
/// `entity_access`; it arrives here through `source_ids`, so adding someone
/// to that channel gives them the session on their next request.
///
/// Public links also work without source IDs. Team links require membership in
/// the owner's current team, while explicit team shares use canonical grants.
pub(super) async fn get_agent_session_access(
    pool: &PgPool,
    agent_session_id: &uuid::Uuid,
    source_ids: &SourceIds,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    let all_level_strings: Vec<Option<String>> = sqlx::query_scalar!(
        r#"
        SELECT access_level::text
        FROM entity_access
        WHERE entity_id = $1
        AND entity_type = 'agent_session'
        AND source_id = ANY($2)

        UNION ALL

        SELECT sp."linkShareAccessLevel"::text
        FROM agent_session s
        JOIN "SharePermission" sp ON sp.id = s.share_permission_id
        WHERE s.id = $1
          AND sp."linkShareAccessLevel" IS NOT NULL
          AND (
              sp."linkShare" = 'PUBLIC'
              OR (
                  sp."linkShare" = 'TEAM'
                  AND EXISTS (
                      SELECT 1 FROM team_user owner_team
                      WHERE owner_team.user_id = s.owner_id
                        AND owner_team.team_id::text = ANY($2)
                  )
              )
          )
        "#,
        agent_session_id,
        &source_ids.0,
    )
    .fetch_all(pool)
    .await?;

    let highest_level = all_level_strings
        .iter()
        .filter_map(|opt| opt.as_ref().and_then(|s| AccessLevel::from_str(s).ok()))
        .max();

    Ok(highest_level)
}

// ---- initiative_access

/// Highest access level the caller's `source_ids` reach on an initiative.
pub(super) async fn get_initiative_access(
    pool: &PgPool,
    initiative_id: &uuid::Uuid,
    source_ids: &SourceIds,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    let levels: Vec<AccessLevel> = sqlx::query_scalar!(
        r#"
        WITH entity_access_grants AS (
            SELECT ea.access_level
            FROM entity_access ea
            WHERE ea.entity_id = $1
              AND ea.entity_type = 'initiative'
              AND ea.source_id = ANY($2)
        ),
        link_share_grants AS (
            SELECT sp."linkShareAccessLevel" AS access_level
            FROM initiative i
            JOIN "SharePermission" sp ON sp.id = i.share_permission_id
            WHERE i.id = $1
              AND sp."linkShareAccessLevel" IS NOT NULL
              AND (
                  sp."linkShare" = 'PUBLIC'
                  OR (
                      sp."linkShare" = 'TEAM'
                      AND EXISTS (
                          SELECT 1
                          FROM team_user owner_team
                          WHERE owner_team.user_id = i.owner_user_id
                            AND owner_team.team_id::text = ANY($2)
                      )
                  )
              )
        )
        SELECT access_level AS "access_level!: AccessLevel"
        FROM (
            SELECT access_level FROM entity_access_grants
            UNION ALL
            SELECT access_level FROM link_share_grants
        ) AS grants
        "#,
        initiative_id,
        &source_ids.0,
    )
    .fetch_all(pool)
    .await?;

    Ok(levels.into_iter().max())
}

// ---- pipeline_access

/// Highest grant on each pipeline, including trashed pipelines for restoration.
pub(super) async fn list_pipeline_access(
    pool: &PgPool,
    sources: &SourceIds,
) -> Result<Vec<(Uuid, AccessLevel)>, sqlx::Error> {
    let rows = sqlx::query!(
        r#"SELECT p.id, ea.access_level AS "access_level!: AccessLevel"
           FROM crm_pipeline_entities p JOIN entity_access ea ON ea.entity_id = p.id AND ea.entity_type = 'crm_pipeline'
           WHERE ea.source_id = ANY($1)"#,
        &sources.0,
    ).fetch_all(pool).await?;
    let mut grants = BTreeMap::<Uuid, AccessLevel>::new();
    for row in rows {
        grants
            .entry(row.id)
            .and_modify(|level| *level = (*level).max(row.access_level))
            .or_insert(row.access_level);
    }
    Ok(grants.into_iter().collect())
}

/// Resolve one pipeline without enumerating the caller's other pipelines.
pub(super) async fn get_pipeline_access(
    pool: &PgPool,
    id: Uuid,
    sources: &SourceIds,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    let levels = sqlx::query_scalar!(
        "SELECT access_level::text FROM entity_access WHERE entity_id = $1 AND entity_type = 'crm_pipeline' AND source_id = ANY($2)",
        id, &sources.0,
    ).fetch_all(pool).await?;
    super::database_access::highest_access_level(&levels)
}

// ---- database_access

/// The highest access level `source_ids` hold on a database: its own grants,
/// Edit through edit or owner on any live form over it, so form editors
/// can read and change their responses, and View through view on a live form
/// that shares its responses. View on a form grants nothing here otherwise.
/// Databases have no share link, so there is no public-sharing arm; a team
/// share is a team-source grant like any other.
/// Both grant paths require an app entity; core storage alone is not shareable.
pub(super) async fn get_database_access(
    pool: &PgPool,
    database_id: &uuid::Uuid,
    source_ids: &SourceIds,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    if source_ids.0.is_empty() {
        return Ok(None);
    }

    let all_level_strings: Vec<Option<String>> = sqlx::query_scalar!(
        r#"
        SELECT access_level::text
        FROM entity_access
        JOIN database_entities d ON d.database_id = entity_access.entity_id
        WHERE entity_id = $1
        AND entity_type = 'database'
        AND source_id = ANY($2)

        UNION ALL

        SELECT 'edit'
        FROM forms f
        JOIN database_entities d ON d.database_id = f.database_id
        JOIN entity_access ea ON ea.entity_id = f.id AND ea.entity_type = 'form'
        WHERE f.database_id = $1
        AND f.trashed_at IS NULL
        AND ea.source_id = ANY($2)
        AND ea.access_level IN ('edit', 'owner')

        UNION ALL

        SELECT 'view'
        FROM forms f
        JOIN database_entities d ON d.database_id = f.database_id
        JOIN entity_access ea ON ea.entity_id = f.id AND ea.entity_type = 'form'
        WHERE f.database_id = $1
        AND f.trashed_at IS NULL
        AND f.responses_visible
        AND ea.source_id = ANY($2)
        AND ea.access_level = 'view'
        "#,
        database_id,
        &source_ids.0,
    )
    .fetch_all(pool)
    .await?;

    super::database_access::highest_access_level(&all_level_strings)
}

/// The highest access level a user has on every database their source ids
/// reach, directly, as Edit through a live form they edit, or as View through
/// a live form that shares its responses, ordered by database id. Trash is
/// the databases domain's concern: a trashed database's grants are still listed.
pub(super) async fn list_database_access(
    pool: &PgPool,
    source_ids: &SourceIds,
) -> Result<Vec<(Uuid, AccessLevel)>, sqlx::Error> {
    if source_ids.0.is_empty() {
        return Ok(Vec::new());
    }

    let rows = sqlx::query!(
        r#"
        SELECT entity_id AS "entity_id!", access_level AS "access_level!: AccessLevel"
        FROM entity_access
        JOIN database_entities d ON d.database_id = entity_access.entity_id
        WHERE entity_type = 'database'
        AND source_id = ANY($1)

        UNION ALL

        SELECT f.database_id, 'edit'::"AccessLevel"
        FROM entity_access ea
        JOIN forms f ON f.id = ea.entity_id
        JOIN database_entities d ON d.database_id = f.database_id
        WHERE ea.entity_type = 'form'
        AND ea.source_id = ANY($1)
        AND ea.access_level IN ('edit', 'owner')
        AND f.trashed_at IS NULL

        UNION ALL

        SELECT f.database_id, 'view'::"AccessLevel"
        FROM entity_access ea
        JOIN forms f ON f.id = ea.entity_id
        JOIN database_entities d ON d.database_id = f.database_id
        WHERE ea.entity_type = 'form'
        AND ea.source_id = ANY($1)
        AND ea.access_level = 'view'
        AND f.responses_visible
        AND f.trashed_at IS NULL
        "#,
        &source_ids.0,
    )
    .fetch_all(pool)
    .await?;

    let mut highest: BTreeMap<Uuid, AccessLevel> = BTreeMap::new();
    for row in rows {
        highest
            .entry(row.entity_id)
            .and_modify(|level| *level = (*level).max(row.access_level))
            .or_insert(row.access_level);
    }
    Ok(highest.into_iter().collect())
}

// ---- database_row_access

/// The highest access level `source_ids` hold on a database row: a row has
/// no grants of its own, so this is its database's access, including Edit
/// through a live form over that database and View through a live form that
/// shares its responses.
pub(super) async fn get_database_row_access(
    pool: &PgPool,
    row_id: &Uuid,
    source_ids: &SourceIds,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    if source_ids.0.is_empty() {
        return Ok(None);
    }

    let all_level_strings: Vec<Option<String>> = sqlx::query_scalar!(
        r#"
        SELECT ea.access_level::text
        FROM database_rows r
        JOIN database_tables t ON t.id = r.table_id
        JOIN database_entities d ON d.database_id = t.database_id
        JOIN entity_access ea ON ea.entity_id = d.database_id
        WHERE r.id = $1
        AND ea.entity_type = 'database'
        AND ea.source_id = ANY($2)

        UNION ALL

        SELECT 'edit'
        FROM database_rows r
        JOIN database_tables t ON t.id = r.table_id
        JOIN forms f ON f.database_id = t.database_id
        JOIN database_entities d ON d.database_id = f.database_id
        JOIN entity_access ea ON ea.entity_id = f.id AND ea.entity_type = 'form'
        WHERE r.id = $1
        AND f.trashed_at IS NULL
        AND ea.source_id = ANY($2)
        AND ea.access_level IN ('edit', 'owner')

        UNION ALL

        SELECT 'view'
        FROM database_rows r
        JOIN database_tables t ON t.id = r.table_id
        JOIN forms f ON f.database_id = t.database_id
        JOIN database_entities d ON d.database_id = f.database_id
        JOIN entity_access ea ON ea.entity_id = f.id AND ea.entity_type = 'form'
        WHERE r.id = $1
        AND f.trashed_at IS NULL
        AND f.responses_visible
        AND ea.source_id = ANY($2)
        AND ea.access_level = 'view'
        "#,
        row_id,
        &source_ids.0,
    )
    .fetch_all(pool)
    .await?;

    super::database_access::highest_access_level(&all_level_strings)
}

/// Highest database grant for each requested row, using the caller's shared
/// sources, including Edit through a live form over the row's database and
/// View through a live form that shares its responses.
pub(super) async fn get_database_rows_access(
    pool: &PgPool,
    row_ids: &[Uuid],
    source_ids: &SourceIds,
) -> Result<HashMap<Uuid, AccessLevel>, sqlx::Error> {
    let mut highest: HashMap<Uuid, AccessLevel> = HashMap::new();
    if row_ids.is_empty() || source_ids.0.is_empty() {
        return Ok(highest);
    }
    let rows = sqlx::query!(
        r#"
        SELECT r.id AS "id!", ea.access_level AS "access_level!: AccessLevel"
        FROM database_rows r
        JOIN database_tables t ON t.id = r.table_id
        JOIN database_entities d ON d.database_id = t.database_id
        JOIN entity_access ea ON ea.entity_id = d.database_id
        WHERE r.id = ANY($1)
        AND ea.entity_type = 'database'
        AND ea.source_id = ANY($2)

        UNION ALL

        SELECT r.id, 'edit'::"AccessLevel"
        FROM database_rows r
        JOIN database_tables t ON t.id = r.table_id
        JOIN forms f ON f.database_id = t.database_id
        JOIN database_entities d ON d.database_id = f.database_id
        JOIN entity_access ea ON ea.entity_id = f.id AND ea.entity_type = 'form'
        WHERE r.id = ANY($1)
        AND f.trashed_at IS NULL
        AND ea.source_id = ANY($2)
        AND ea.access_level IN ('edit', 'owner')

        UNION ALL

        SELECT r.id, 'view'::"AccessLevel"
        FROM database_rows r
        JOIN database_tables t ON t.id = r.table_id
        JOIN forms f ON f.database_id = t.database_id
        JOIN database_entities d ON d.database_id = f.database_id
        JOIN entity_access ea ON ea.entity_id = f.id AND ea.entity_type = 'form'
        WHERE r.id = ANY($1)
        AND f.trashed_at IS NULL
        AND f.responses_visible
        AND ea.source_id = ANY($2)
        AND ea.access_level = 'view'
        "#,
        row_ids,
        &source_ids.0,
    )
    .fetch_all(pool)
    .await?;
    for row in rows {
        highest
            .entry(row.id)
            .and_modify(|level| *level = (*level).max(row.access_level))
            .or_insert(row.access_level);
    }
    Ok(highest)
}

// ---- form_access

/// The highest access level `source_ids` hold on a form: its `entity_access`
/// grants, plus View for anyone while the form's audience is public and it is
/// not trashed. With no source ids (an anonymous caller) only the public arm
/// can answer, and it never answers more than View.
pub(super) async fn get_form_access(
    pool: &PgPool,
    form_id: &Uuid,
    source_ids: &SourceIds,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    let all_level_strings: Vec<Option<String>> = sqlx::query_scalar!(
        r#"
        SELECT access_level::text
        FROM entity_access
        WHERE entity_id = $1
        AND entity_type = 'form'
        AND source_id = ANY($2)

        UNION ALL

        SELECT 'view'
        FROM forms
        WHERE id = $1
        AND audience = 'public'
        AND trashed_at IS NULL
        "#,
        form_id,
        &source_ids.0,
    )
    .fetch_all(pool)
    .await?;

    super::database_access::highest_access_level(&all_level_strings)
}

/// The highest access level `source_ids` hold through grants on every live
/// form they reach, ordered by form id. The public arm is deliberately absent:
/// a public audience makes a form answerable by link, not listed to everyone.
pub(super) async fn list_form_access(
    pool: &PgPool,
    source_ids: &SourceIds,
) -> Result<Vec<(Uuid, AccessLevel)>, sqlx::Error> {
    if source_ids.0.is_empty() {
        return Ok(Vec::new());
    }

    let rows = sqlx::query!(
        r#"
        SELECT ea.entity_id, ea.access_level AS "access_level: AccessLevel"
        FROM entity_access ea
        JOIN forms f ON f.id = ea.entity_id
        WHERE ea.entity_type = 'form'
        AND ea.source_id = ANY($1)
        AND f.trashed_at IS NULL
        "#,
        &source_ids.0,
    )
    .fetch_all(pool)
    .await?;

    let mut highest: BTreeMap<Uuid, AccessLevel> = BTreeMap::new();
    for row in rows {
        highest
            .entry(row.entity_id)
            .and_modify(|level| *level = (*level).max(row.access_level))
            .or_insert(row.access_level);
    }
    Ok(highest.into_iter().collect())
}

// ---- scheduled_action_access

/// Highest grant the caller's sources hold on one scheduled action.
pub(super) async fn get_scheduled_action_access(
    pool: &PgPool,
    id: &uuid::Uuid,
    source_ids: &SourceIds,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    let levels: Vec<AccessLevel> = sqlx::query_scalar!(
        r#"
        SELECT access_level AS "access_level!: AccessLevel"
        FROM entity_access
        WHERE entity_id = $1 AND entity_type = 'scheduled_action' AND source_id = ANY($2)
        "#,
        id,
        &source_ids.0,
    )
    .fetch_all(pool)
    .await?;

    Ok(levels.into_iter().max())
}

/// Live scheduled-action ids the caller's sources can reach.
///
/// The join drops grants whose action row is gone.
pub(super) async fn accessible_scheduled_action_ids(
    pool: &PgPool,
    source_ids: &SourceIds,
) -> Result<Vec<uuid::Uuid>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        SELECT DISTINCT ea.entity_id
        FROM entity_access ea
        JOIN scheduled_action sa ON sa.id = ea.entity_id
        WHERE ea.entity_type = 'scheduled_action' AND ea.source_id = ANY($1)
        "#,
        &source_ids.0,
    )
    .fetch_all(pool)
    .await
}

// ---- external_chat_access

/// Highest access level the caller's `source_ids` reach on an external chat,
/// from the database's one implementation of the rule
/// (`external_chat_access_level`, also behind `external_chat_can_view` and
/// the attachment branch of `document_access`).
pub(super) async fn get_external_chat_access(
    pool: &PgPool,
    chat_id: &uuid::Uuid,
    source_ids: &SourceIds,
) -> Result<Option<AccessLevel>, sqlx::Error> {
    sqlx::query_scalar!(
        r#"SELECT external_chat_access_level($1, $2) AS "access_level?: AccessLevel""#,
        chat_id,
        &source_ids.0,
    )
    .fetch_one(pool)
    .await
}
