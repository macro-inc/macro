//! Who an access statement checks.
//!
//! Statements never load the viewer's sources. They pass the viewer to the
//! SQL functions `entity_access_source_matches(source, viewer, scope_team)`
//! (point checks) and `entity_access_viewer_sources(viewer, scope_team)`
//! (listings), which resolve the viewer's teams and channels by index.

#[cfg(test)]
mod test;

#[cfg(not(test))]
use cached::proc_macro::cached;

use bot_id::BotIdStr;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::PgPool;
use uuid::Uuid;

/// The viewer an access statement checks.
///
/// A user's sources are themself, their teams and the channels they have not
/// left. An active bot's are itself, its team, the team's team channels and
/// the channels it has not left other than direct agent conversations, which
/// belong to the person the agent talks with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Viewer<'a> {
    /// No user, or a bot no longer active in the team: no sources at all.
    Anonymous,
    /// A signed-in user.
    User(&'a str),
    /// An active bot acting in its team.
    Bot {
        /// The bot's storage id, the principal its grants name.
        principal: &'a str,
        /// The team the bot acts in.
        team: Uuid,
    },
}

impl<'a> Viewer<'a> {
    /// The user, or [`Viewer::Anonymous`] when there is none.
    pub(crate) fn from_user(user_id: Option<&'a MacroUserId<Lowercase<'_>>>) -> Self {
        user_id.map_or(Self::Anonymous, |user_id| Self::User(user_id.as_ref()))
    }

    /// True when the viewer has no sources, so only public links can apply.
    pub(crate) fn is_anonymous(&self) -> bool {
        matches!(self, Self::Anonymous)
    }

    /// The `viewer` argument of the SQL functions: NULL matches nothing.
    pub(crate) fn id(&self) -> Option<&'a str> {
        match *self {
            Self::Anonymous => None,
            Self::User(user_id) => Some(user_id),
            Self::Bot { principal, .. } => Some(principal),
        }
    }

    /// The `scope_team` argument of the SQL functions: NULL for a user.
    pub(crate) fn scope_team(&self) -> Option<Uuid> {
        match *self {
            Self::Bot { team, .. } => Some(team),
            Self::Anonymous | Self::User(_) => None,
        }
    }

    /// The user id, for statements with user-only paths (ownership, inbox
    /// delegation). A bot has none.
    pub(crate) fn user_id(&self) -> Option<&'a str> {
        match *self {
            Self::User(user_id) => Some(user_id),
            Self::Anonymous | Self::Bot { .. } => None,
        }
    }
}

/// The bot as a viewer in `team_id`, or [`Viewer::Anonymous`] when the bot is
/// deleted or belongs to another team.
#[tracing::instrument(skip(pool), err)]
pub(crate) async fn team_bot_viewer<'a>(
    pool: &PgPool,
    bot_principal: &'a BotIdStr<'_>,
    team_id: Uuid,
) -> Result<Viewer<'a>, sqlx::Error> {
    Ok(if is_active_team_bot(pool, bot_principal, team_id).await? {
        Viewer::Bot {
            principal: bot_principal.as_ref(),
            team: team_id,
        }
    } else {
        Viewer::Anonymous
    })
}

/// Whether the bot is live in `team_id`. Cached briefly, as bot checks
/// repeat for every item an agent reads.
#[cfg_attr(
    not(test),
    cached(
        time = 10,
        result = true,
        key = "String",
        convert = r#"{format!("{}:{}", bot_principal, team_id)}"#,
    )
)]
async fn is_active_team_bot(
    pool: &PgPool,
    bot_principal: &BotIdStr<'_>,
    team_id: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar!(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM bots
            WHERE id = $1
              AND team_id = $2
              AND deleted_at IS NULL
        ) AS "active!"
        "#,
        bot_principal.as_uuid(),
        team_id,
    )
    .fetch_one(pool)
    .await
}
