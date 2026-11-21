//! Which Chat sections hold a channel, for notification ingress.

use cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::section_settings::{
    ChannelSection, ChannelSectionMembership, ChannelSectionMembershipReader,
};
use rootcause::Report;
use sqlx::PgPool;
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

/// Reads section membership with the same scope and rule matching the
/// section listing uses, so a notification follows the sections the user
/// sees.
#[derive(Clone)]
pub struct PgChannelSectionMembership(pub PgPool);

impl ChannelSectionMembershipReader for PgChannelSectionMembership {
    #[tracing::instrument(
        name = "channel_sections.membership",
        skip_all,
        fields(channel_id = %channel_id, user_count = user_ids.len(), sectioned_user_count = tracing::field::Empty),
        err
    )]
    async fn memberships<'a>(
        &self,
        channel_id: Uuid,
        user_ids: &[MacroUserIdStr<'a>],
    ) -> Result<ChannelSectionMembership, Report> {
        let ids: Vec<String> = user_ids.iter().map(|id| id.to_string()).collect();
        let mut tx = self.0.begin().await?;
        // The work grows with the users asked for; bound it well under the
        // ingress queue's visibility timeout.
        sqlx::query!("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *tx)
            .await?;

        // The channel's team sections are the same for every member, so they
        // are found once. Each user then adds their own: team sections only
        // when they belong to the channel's team (`team_user.user_id` is
        // unique, so that is one lookup, never a scan of the team), and
        // personal sections, manual or by name rule, for team, public and
        // private channels they are an active member of, as the listing
        // requires; direct messages are never in a section. Rule matching
        // repeats the section listing's `strpos(lower(..))`.
        let rows = sqlx::query!(
            r#"
            WITH c AS MATERIALIZED (
                SELECT id, team_id, channel_type::text AS channel_type,
                       lower(coalesce(name, '')) AS lname
                FROM comms_channels WHERE id = $1
            ),
            team_hits AS MATERIALIZED (
                SELECT lc.label_id AS id
                FROM c JOIN channel_label_channel lc
                  ON lc.scope_key = 'team:' || c.team_id::text AND lc.channel_id = c.id
                WHERE c.channel_type = 'team'
                UNION ALL
                SELECT l.id
                FROM c JOIN channel_label l ON l.scope_key = 'team:' || c.team_id::text
                WHERE c.channel_type = 'team' AND l.name_contains IS NOT NULL
                  AND strpos(c.lname, lower(l.name_contains)) > 0
            )
            SELECT r.user_id AS "user_id!",
                (SELECT channel_type FROM c) AS channel_type,
                ARRAY(
                    SELECT th.id FROM team_hits th
                    WHERE (SELECT tu.team_id FROM team_user tu WHERE tu.user_id = r.user_id)
                          = (SELECT team_id FROM c)
                    UNION ALL
                    SELECT personal.id FROM (
                        SELECT lc.label_id AS id FROM channel_label_channel lc, c
                        WHERE lc.scope_key = 'user:' || r.user_id AND lc.channel_id = c.id
                        UNION ALL
                        SELECT l.id FROM channel_label l, c
                        WHERE l.scope_key = 'user:' || r.user_id
                          AND l.name_contains IS NOT NULL
                          AND strpos(c.lname, lower(l.name_contains)) > 0
                    ) personal, c
                    WHERE c.channel_type IN ('team', 'public', 'private')
                      AND EXISTS (
                          SELECT 1 FROM comms_channel_participants p
                          WHERE p.channel_id = c.id AND p.user_id = r.user_id
                            AND p.left_at IS NULL)
                ) AS "label_ids!",
                EXISTS (
                    SELECT 1 FROM favorite f, c
                    WHERE f.user_id = r.user_id AND f.entity_type = 'channel'
                      AND f.entity_id = c.id::text
                ) AS "favorite!"
            FROM unnest($2::text[]) AS r(user_id)
            "#,
            channel_id,
            &ids,
        )
        .fetch_all(&mut *tx)
        .await?;
        tx.commit().await?;

        let built_in = rows
            .first()
            .and_then(|row| match row.channel_type.as_deref() {
                Some("direct_message") => Some(ChannelSection::DirectMessages),
                Some("team") => Some(ChannelSection::TeamChannels),
                _ => None,
            });
        let mut labels = HashMap::new();
        let mut favorites = HashSet::new();
        for row in rows {
            let Ok(user_id) = MacroUserIdStr::parse_from_str(&row.user_id) else {
                continue;
            };
            let user_id = user_id.into_owned();

            if row.favorite {
                favorites.insert(user_id.clone());
            }

            if !row.label_ids.is_empty() {
                labels.insert(user_id, row.label_ids);
            }
        }

        tracing::Span::current().record("sectioned_user_count", labels.len());
        Ok(ChannelSectionMembership {
            built_in,
            labels,
            favorites,
        })
    }
}

#[cfg(test)]
mod test;
