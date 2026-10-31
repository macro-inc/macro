//! Viewer-aware channel names, backed by Postgres: batch resolution and name
//! search share one rule. A channel is known by its stored name when it has
//! one. DMs and unnamed private channels are known by the *other*
//! participants: people by `first_name last_name` from `macro_user_info`
//! (skipping `N/A` parts) or else the local part of their email, bots by their
//! registry name or `bots` row. Unnamed public and team channels fall back to
//! `#<id prefix>`. [`match_channel_names`] applies the same rule in SQL, so a
//! search finds exactly the channels whose resolved name the viewer would
//! recognise.

use std::collections::{HashMap, HashSet};

use bot_id::BotId;
use chrono::{DateTime, Utc};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::PgPool;
use uuid::Uuid;

use super::pg_channels_repo::{
    load_bot_display_names, load_user_display_names, principal_display_name,
};
use crate::domain::models::{ChannelType, NameLookup};

/// Batch-resolve display names for a list of channel ids from the perspective
/// of `viewer_user_id`. The viewer is only used to pick the right "other
/// person" for DM channels; it is not an authorization check.
///
/// Channels the query can't find simply have no entry in the returned map.
#[tracing::instrument(skip(pool), err)]
pub async fn batch_resolve_channel_names<'a>(
    pool: &PgPool,
    channel_ids: &[Uuid],
    viewer_user_id: MacroUserIdStr<'a>,
) -> Result<HashMap<Uuid, String>, sqlx::Error> {
    if channel_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let channels = load_channels(pool, channel_ids).await?;
    let names = load_viewer_dependent_names(pool, &channels).await?;

    Ok(channels
        .iter()
        .map(|(channel_id, (name, channel_type))| {
            let resolved_name = names.resolve(
                *channel_type,
                name.as_deref(),
                *channel_id,
                viewer_user_id.as_ref(),
            );
            (*channel_id, resolved_name)
        })
        .collect())
}

/// Resolve the display name of one channel from the perspective of each of
/// `viewer_user_ids`, keyed by viewer.
///
/// DM and unnamed private channels are named after the *other* participants,
/// so the same channel reads differently to each member: to the caller a DM
/// is named after the callee, and to the callee it is named after the caller.
/// Use this when addressing several users about one channel (e.g. notifying
/// channel members) so each sees the name they know the channel by.
///
/// Returns an empty map when the channel does not exist. The viewer is not an
/// authorization check.
#[tracing::instrument(skip(pool), err)]
pub async fn resolve_channel_name_for_viewers<'a>(
    pool: &PgPool,
    channel_id: Uuid,
    viewer_user_ids: &[MacroUserIdStr<'a>],
) -> Result<HashMap<MacroUserIdStr<'static>, String>, sqlx::Error> {
    if viewer_user_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let channels = load_channels(pool, &[channel_id]).await?;
    let Some((name, channel_type)) = channels.get(&channel_id) else {
        return Ok(HashMap::new());
    };
    let names = load_viewer_dependent_names(pool, &channels).await?;

    Ok(viewer_user_ids
        .iter()
        .map(|viewer| {
            let resolved_name =
                names.resolve(*channel_type, name.as_deref(), channel_id, viewer.as_ref());
            (viewer.clone().into_owned(), resolved_name)
        })
        .collect())
}

/// A channel whose viewer-facing name matched a [`ChannelNameSearch`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelNameMatch {
    /// The matched channel.
    pub channel_id: Uuid,
    /// The channel's `updated_at`, which orders the matches.
    pub updated_at: DateTime<Utc>,
}

/// A name search over the channels a viewer actively participates in.
#[derive(Debug)]
pub struct ChannelNameSearch<'a> {
    /// Whose channels to search, and whose view of each name to match.
    pub viewer_user_id: MacroUserIdStr<'a>,
    /// One pattern per search term. A channel matches when every pattern
    /// matches its stored name or the display name of some participant other
    /// than the viewer.
    pub patterns: &'a [String],
    /// Patterns are case-insensitive POSIX regexes when set, `ILIKE` patterns
    /// otherwise.
    pub regex_patterns: bool,
    /// Only these channels; empty means every channel.
    pub channel_ids: &'a [Uuid],
    /// Only these channel types; empty means every type.
    pub channel_types: &'a [ChannelType],
    /// Keyset cursor: only channels ordered strictly after `(updated_at, id)`.
    pub after: Option<(DateTime<Utc>, Uuid)>,
    /// Maximum number of channels to return.
    pub limit: i64,
}

/// Channels, newest `updated_at` first, whose name as the viewer sees it
/// matches every pattern of `search`: each pattern must match the stored name
/// or the display name of some participant other than the viewer, so a
/// two-term search finds an unnamed group by two of its members. Only the
/// viewer's active participations are considered, which also scopes the
/// search to channels the viewer may see.
#[tracing::instrument(
    skip_all,
    fields(
        user_id = %search.viewer_user_id.as_ref(),
        pattern_count = search.patterns.len(),
        channel_types = ?search.channel_types,
        channel_id_count = search.channel_ids.len(),
        limit = search.limit,
        result_count = tracing::field::Empty,
    ),
    err
)]
pub async fn match_channel_names(
    pool: &PgPool,
    search: ChannelNameSearch<'_>,
) -> Result<Vec<ChannelNameMatch>, sqlx::Error> {
    if search.patterns.is_empty() || search.limit <= 0 {
        return Ok(Vec::new());
    }
    let channel_types: Vec<String> = search
        .channel_types
        .iter()
        .map(ToString::to_string)
        .collect();
    let (after_updated_at, after_channel_id) = match search.after {
        Some((updated_at, channel_id)) => (Some(updated_at), Some(channel_id)),
        None => (None, None),
    };
    // First-party bots have no `bots` row; their names come from the registry.
    let (system_bot_ids, system_bot_names): (Vec<Uuid>, Vec<String>) = bot_id::SYSTEM_BOTS
        .iter()
        .map(|bot| (bot.id.as_uuid(), bot.name.to_string()))
        .unzip();

    let rows = sqlx::query!(
        r#"
        WITH viewer_channels AS (
            SELECT c.id, c.name, c.channel_type, c.updated_at
            FROM comms_channel_participants me
            JOIN comms_channels c ON c.id = me.channel_id
            WHERE me.user_id = $1
                AND me.left_at IS NULL
                AND (cardinality($2::uuid[]) = 0 OR c.id = ANY($2::uuid[]))
                AND (cardinality($3::text[]) = 0 OR c.channel_type::text = ANY($3::text[]))
                AND (
                    $4::timestamptz IS NULL
                    OR (c.updated_at, c.id) < ($4::timestamptz, $5::uuid)
                )
        ),
        patterns AS (
            SELECT pattern, ordinality AS term
            FROM unnest($6::text[]) WITH ORDINALITY AS p(pattern, ordinality)
        ),
        other_participant_names AS (
            SELECT
                vc.id AS channel_id,
                CASE
                    WHEN other.user_id LIKE 'bot|%' THEN COALESCE(system_bot.name, bot.name, 'Bot')
                    ELSE COALESCE(
                        NULLIF(
                            concat_ws(
                                ' ',
                                NULLIF(mui.first_name, 'N/A'),
                                NULLIF(mui.last_name, 'N/A')
                            ),
                            ''
                        ),
                        split_part(split_part(other.user_id, '|', 2), '@', 1)
                    )
                END AS name
            FROM viewer_channels vc
            JOIN comms_channel_participants other
                ON other.channel_id = vc.id
                AND other.left_at IS NULL
                AND other.user_id <> $1
            LEFT JOIN "User" u ON u.id = other.user_id
            LEFT JOIN macro_user_info mui ON mui.macro_user_id = u.macro_user_id
            LEFT JOIN unnest($8::uuid[], $9::text[]) AS system_bot(id, name)
                ON other.user_id = 'bot|' || system_bot.id::text
            LEFT JOIN bots bot
                ON other.user_id = 'bot|' || bot.id::text
                AND bot.deleted_at IS NULL
            WHERE vc.channel_type = 'direct_message'
                OR (vc.channel_type = 'private' AND NULLIF(BTRIM(vc.name), '') IS NULL)
        ),
        matched_terms AS (
            SELECT vc.id AS channel_id, p.term
            FROM viewer_channels vc
            CROSS JOIN patterns p
            WHERE NULLIF(BTRIM(vc.name), '') IS NOT NULL
                AND CASE
                    WHEN $7::bool THEN vc.name ~* p.pattern
                    ELSE vc.name ILIKE p.pattern
                END
            UNION
            SELECT o.channel_id, p.term
            FROM other_participant_names o
            CROSS JOIN patterns p
            WHERE CASE
                WHEN $7::bool THEN o.name ~* p.pattern
                ELSE o.name ILIKE p.pattern
            END
        )
        SELECT vc.id AS "id!", vc.updated_at AS "updated_at!"
        FROM viewer_channels vc
        JOIN matched_terms m ON m.channel_id = vc.id
        GROUP BY vc.id, vc.updated_at
        HAVING count(DISTINCT m.term) = cardinality($6::text[])
        ORDER BY vc.updated_at DESC, vc.id DESC
        LIMIT $10
        "#,
        search.viewer_user_id.as_ref(),
        search.channel_ids,
        &channel_types,
        after_updated_at,
        after_channel_id,
        search.patterns,
        search.regex_patterns,
        &system_bot_ids,
        &system_bot_names,
        search.limit,
    )
    .fetch_all(pool)
    .await?;
    tracing::Span::current().record("result_count", rows.len());

    Ok(rows
        .into_iter()
        .map(|row| ChannelNameMatch {
            channel_id: row.id,
            updated_at: row.updated_at,
        })
        .collect())
}

type LoadedChannels = HashMap<Uuid, (Option<String>, ChannelType)>;

async fn load_channels(pool: &PgPool, channel_ids: &[Uuid]) -> Result<LoadedChannels, sqlx::Error> {
    let channel_rows = sqlx::query!(
        r#"
        SELECT id, name, channel_type as "channel_type!: ChannelType"
        FROM comms_channels
        WHERE id = ANY($1)
        "#,
        channel_ids,
    )
    .fetch_all(pool)
    .await?;

    Ok(channel_rows
        .into_iter()
        .map(|r| (r.id, (r.name, r.channel_type)))
        .collect())
}

/// Participants and display names of the channels whose name depends on who
/// is looking (DMs and unnamed private channels).
#[derive(Default)]
struct ViewerDependentNames {
    participants_by_channel: HashMap<Uuid, Vec<String>>,
    user_names: NameLookup,
    bot_names: HashMap<BotId, String>,
}

impl ViewerDependentNames {
    fn resolve(
        &self,
        channel_type: ChannelType,
        stored_name: Option<&str>,
        channel_id: Uuid,
        viewer_user_id: &str,
    ) -> String {
        let participants = self
            .participants_by_channel
            .get(&channel_id)
            .map(Vec::as_slice)
            .unwrap_or_default();
        resolve_channel_name(
            channel_type,
            stored_name,
            channel_id,
            viewer_user_id,
            participants,
            &self.user_names,
            &self.bot_names,
        )
    }
}

async fn load_viewer_dependent_names(
    pool: &PgPool,
    channels: &LoadedChannels,
) -> Result<ViewerDependentNames, sqlx::Error> {
    let needs_participants: Vec<Uuid> = channels
        .iter()
        .filter(|(_, (name, ct))| {
            matches!(ct, ChannelType::DirectMessage)
                || (matches!(ct, ChannelType::Private)
                    && name.as_ref().is_none_or(|n| n.trim().is_empty()))
        })
        .map(|(id, _)| *id)
        .collect();

    if needs_participants.is_empty() {
        return Ok(ViewerDependentNames::default());
    }

    let participant_rows = sqlx::query!(
        r#"
        SELECT channel_id, user_id
        FROM comms_channel_participants
        WHERE channel_id = ANY($1) AND left_at IS NULL
        "#,
        &needs_participants
    )
    .fetch_all(pool)
    .await?;

    let mut participants_by_channel: HashMap<Uuid, Vec<String>> = HashMap::new();
    let mut user_ids: HashSet<MacroUserIdStr<'static>> = HashSet::new();
    let mut bot_ids: HashSet<BotId> = HashSet::new();
    for row in participant_rows {
        if let Ok(user_id) = MacroUserIdStr::try_from(row.user_id.clone()) {
            user_ids.insert(user_id);
        } else if let Ok(bot) = bot_id::BotIdStr::parse_from_str(&row.user_id) {
            bot_ids.insert(bot.bot_id());
        }
        participants_by_channel
            .entry(row.channel_id)
            .or_default()
            .push(row.user_id);
    }
    let user_ids: Vec<MacroUserIdStr<'static>> = user_ids.into_iter().collect();
    let bot_ids: Vec<BotId> = bot_ids.into_iter().collect();
    let user_names = load_user_display_names(pool, &user_ids).await?;
    let bot_names = load_bot_display_names(pool, &bot_ids).await?;

    Ok(ViewerDependentNames {
        participants_by_channel,
        user_names,
        bot_names,
    })
}

fn resolve_channel_name(
    channel_type: ChannelType,
    stored_name: Option<&str>,
    channel_id: Uuid,
    viewer_user_id: &str,
    participants: &[String],
    user_names: &NameLookup,
    bot_names: &HashMap<BotId, String>,
) -> String {
    if let Some(name) = stored_name.filter(|name| !name.trim().is_empty()) {
        return name.to_string();
    }

    let other_names = || {
        participants
            .iter()
            .filter(|principal| principal.as_str() != viewer_user_id)
            .filter_map(|principal| principal_display_name(principal, user_names, bot_names))
    };
    match channel_type {
        ChannelType::Public | ChannelType::Team => format!("#{}", &channel_id.to_string()[..8]),
        ChannelType::Private => {
            let mut names: Vec<String> = other_names().collect();
            names.sort();
            if names.is_empty() {
                "Private channel".to_string()
            } else {
                names.join(", ")
            }
        }
        ChannelType::DirectMessage => other_names()
            .next()
            .unwrap_or_else(|| "Direct message".to_string()),
    }
}

#[cfg(test)]
mod test;
