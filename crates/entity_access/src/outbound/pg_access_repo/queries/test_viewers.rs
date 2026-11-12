//! Real memberships for test viewers.
//!
//! Access statements read a viewer's teams and channels from the database, so
//! a test viewer is a user row with real `team_user` and
//! `comms_channel_participants` rows, not a hand-written source list.

use super::{Viewer, source_list_oracle, source_list_oracle::SourceIds, team_bot_viewer};
use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

/// Create `user_id` (once) as a member of `team` (a user is in at most one
/// team). A team that does not exist yet is created with this user as owner.
pub(crate) async fn user_in_team(pool: &PgPool, user_id: &str, team: Uuid) -> anyhow::Result<()> {
    ensure_user(pool, user_id).await?;
    sqlx::query!(
        r#"INSERT INTO team (id, name, owner_id) VALUES ($1, 'Viewer Team', $2)
           ON CONFLICT (id) DO NOTHING"#,
        team,
        user_id,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, 'member')"#,
        user_id,
        team,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Create `user_id` (once) as a current participant of `channel`, creating
/// a private channel with that id when it does not exist yet.
pub(crate) async fn user_in_channel(
    pool: &PgPool,
    user_id: &str,
    channel: Uuid,
) -> anyhow::Result<()> {
    ensure_user(pool, user_id).await?;
    sqlx::query!(
        r#"INSERT INTO comms_channels (id, name, channel_type, owner_id)
           VALUES ($1, 'Viewer Channel', 'private', $2)
           ON CONFLICT (id) DO NOTHING"#,
        channel,
        user_id,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO comms_channel_participants (channel_id, user_id, role)
           VALUES ($1, $2, 'member')"#,
        channel,
        user_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Create the `User` row (and its `macro_user`) unless it exists.
pub(crate) async fn ensure_user(pool: &PgPool, user_id: &str) -> anyhow::Result<()> {
    let exists = sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM "User" WHERE id = $1) AS "exists!""#,
        user_id,
    )
    .fetch_one(pool)
    .await?;
    if exists {
        return Ok(());
    }
    let macro_user_id = Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id)
           VALUES ($1, $2, $2, $2)"#,
        macro_user_id,
        user_id,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        user_id,
        macro_user_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// A user with no rows at all: their only source is themself.
const MATRIX_STRANGER: &str = "macro|matrix-stranger@example.com";

/// The viewer a matrix entry checks, owned so the matrix can hold it.
#[derive(Debug, Clone)]
enum MatrixViewerKind {
    Anonymous,
    User(String),
    Bot { principal: String, team: Uuid },
}

/// One viewer of the equality matrix: the source list the old statements
/// got for it, and the viewer the membership form gets.
#[derive(Debug, Clone)]
pub(crate) struct MatrixViewer {
    /// Who this is, for assertion messages.
    pub(crate) label: String,
    /// What `get_user_source_ids` or `get_team_scope_source_ids` returned.
    pub(crate) sources: SourceIds,
    kind: MatrixViewerKind,
}

impl MatrixViewer {
    /// The viewer the membership form checks.
    pub(crate) fn viewer(&self) -> Viewer<'_> {
        match &self.kind {
            MatrixViewerKind::Anonymous => Viewer::Anonymous,
            MatrixViewerKind::User(user_id) => Viewer::User(user_id),
            MatrixViewerKind::Bot { principal, team } => Viewer::Bot {
                principal,
                team: *team,
            },
        }
    }

    /// The user id, for old statements that also took the caller's user id.
    pub(crate) fn user_id(&self) -> Option<MacroUserIdStr<'_>> {
        match &self.kind {
            MatrixViewerKind::User(user_id) => MacroUserIdStr::parse_from_str(user_id).ok(),
            MatrixViewerKind::Anonymous | MatrixViewerKind::Bot { .. } => None,
        }
    }
}

/// Every viewer in the database, resolved both ways: anonymous, each user
/// (and one with no rows), and each bot acting in each team, which covers
/// active bots, deleted ones and bots outside the team. The memberships come
/// from the `viewer_matrix` fixture and any other fixture the test loads.
pub(crate) async fn matrix_viewers(pool: &PgPool) -> anyhow::Result<Vec<MatrixViewer>> {
    let mut viewers = vec![MatrixViewer {
        label: "anonymous".to_string(),
        sources: source_list_oracle::get_user_source_ids(pool, None).await?,
        kind: MatrixViewerKind::Anonymous,
    }];

    let mut users = sqlx::query_scalar!(r#"SELECT id FROM "User" ORDER BY id"#)
        .fetch_all(pool)
        .await?;
    users.push(MATRIX_STRANGER.to_string());
    for user in users {
        let Ok(user_id) = MacroUserIdStr::parse_from_str(&user) else {
            continue;
        };
        let sources = source_list_oracle::get_user_source_ids(pool, Some(&*user_id)).await?;
        viewers.push(MatrixViewer {
            label: user.clone(),
            sources,
            kind: MatrixViewerKind::User(user),
        });
    }

    let bot_teams = sqlx::query!(
        r#"SELECT b.id AS bot, t.id AS team FROM bots b CROSS JOIN team t ORDER BY 1, 2"#
    )
    .fetch_all(pool)
    .await?;
    for row in bot_teams {
        let principal = BotId::new_from_uuid(row.bot).into_storage_id();
        let sources =
            source_list_oracle::get_team_scope_source_ids(pool, &principal, &row.team).await?;
        let kind = match team_bot_viewer(pool, &principal, row.team).await? {
            Viewer::Bot { principal, team } => MatrixViewerKind::Bot {
                principal: principal.to_string(),
                team,
            },
            Viewer::Anonymous => MatrixViewerKind::Anonymous,
            Viewer::User(_) => anyhow::bail!("a bot resolved to a user"),
        };
        viewers.push(MatrixViewer {
            label: format!("{principal} in {}", row.team),
            sources,
            kind,
        });
    }
    Ok(viewers)
}

/// Run `check` for every viewer on every item, require the old and new
/// answers to agree, and require the answers to tell viewers apart, so a
/// fixture that grants nothing cannot pass.
pub(crate) async fn assert_matrix_agrees<I, T, F>(
    viewers: &[MatrixViewer],
    items: &[I],
    mut check: F,
) -> anyhow::Result<()>
where
    I: std::fmt::Display,
    T: PartialEq + std::fmt::Debug,
    F: AsyncFnMut(&MatrixViewer, &I) -> anyhow::Result<(T, T)>,
{
    anyhow::ensure!(!items.is_empty(), "the fixture created no items");
    let mut answers = std::collections::HashSet::new();
    for viewer in viewers {
        let mut row = Vec::with_capacity(items.len());
        for item in items {
            let (old, new) = check(viewer, item).await?;
            assert_eq!(new, old, "{} on {item}", viewer.label);
            row.push(format!("{new:?}"));
        }
        answers.insert(row);
    }
    anyhow::ensure!(
        answers.len() >= 4,
        "only {} distinct answer rows across {} viewers",
        answers.len(),
        viewers.len()
    );
    Ok(())
}
