//! Postgres persistence for users' per-channel notification settings.

use crate::domain::channel_settings::{
    ChannelNotificationKind, ChannelNotificationSettings, ChannelNotificationSettingsChange,
    ChannelNotificationSettingsRepository, ChannelSettingsWriteError,
};
use cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use sqlx::PgPool;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use uuid::Uuid;

/// Postgres error code for a foreign key violation.
const FOREIGN_KEY_VIOLATION: &str = "23503";

/// Adapter for the `user_channel_notification_setting` table.
#[derive(Clone)]
pub struct PgChannelNotificationSettingsRepository(pub PgPool);

/// Parse stored event types, skipping any this build does not know.
fn parse_kinds(event_types: Vec<String>) -> BTreeSet<ChannelNotificationKind> {
    event_types
        .into_iter()
        .filter_map(|event_type| {
            event_type
                .parse()
                .inspect_err(|_| {
                    tracing::warn!(event_type, "Skipping unknown channel notification setting");
                })
                .ok()
        })
        .collect()
}

fn event_types(kinds: &BTreeSet<ChannelNotificationKind>) -> Vec<String> {
    kinds
        .iter()
        .map(|kind| <&'static str>::from(*kind).to_owned())
        .collect()
}

fn settings(
    disabled: Vec<String>,
    enabled: Vec<String>,
    overrides_section_mute: bool,
) -> ChannelNotificationSettings {
    ChannelNotificationSettings {
        disabled: parse_kinds(disabled),
        enabled: parse_kinds(enabled),
        overrides_section_mute,
    }
}

fn write_error(error: sqlx::Error) -> ChannelSettingsWriteError {
    let code = error.as_database_error().and_then(|error| error.code());
    if code.as_deref() == Some(FOREIGN_KEY_VIOLATION) {
        ChannelSettingsWriteError::UnknownChannel
    } else {
        ChannelSettingsWriteError::Repository(error.into())
    }
}

impl ChannelNotificationSettingsRepository for PgChannelNotificationSettingsRepository {
    async fn list(
        &self,
        user: MacroUserIdStr<'_>,
    ) -> Result<BTreeMap<Uuid, ChannelNotificationSettings>, Report> {
        let rows = sqlx::query!(
            r#"SELECT channel_id, disabled_event_types, enabled_event_types, section_mute_override
               FROM user_channel_notification_setting
               WHERE user_id = $1"#,
            user.as_ref()
        )
        .fetch_all(&self.0)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| {
                let settings = settings(
                    row.disabled_event_types,
                    row.enabled_event_types,
                    row.section_mute_override,
                );
                (row.channel_id, settings)
            })
            .filter(|(_, settings)| !settings.is_empty())
            .collect())
    }

    async fn update(
        &self,
        user: MacroUserIdStr<'_>,
        channel_id: Uuid,
        change: &ChannelNotificationSettingsChange,
    ) -> Result<ChannelNotificationSettings, ChannelSettingsWriteError> {
        let enable = event_types(&change.enable);
        let disable = event_types(&change.disable);
        let inherit = event_types(&change.inherit);
        let mut tx = self.0.begin().await.map_err(write_error)?;

        // A kind is in at most one of the two arrays: each change adds it to
        // the array it names and removes it from the other. The upsert locks
        // the row, so concurrent changes to one channel apply one after the
        // other. A row is left with no settings only inside this transaction:
        // it is deleted before commit.
        let row = sqlx::query!(
            r#"INSERT INTO user_channel_notification_setting AS s
                   (user_id, channel_id, disabled_event_types, enabled_event_types,
                    section_mute_override)
               VALUES ($1, $2, ARRAY(SELECT unnest($3::text[]) ORDER BY 1),
                       ARRAY(SELECT unnest($4::text[]) ORDER BY 1), COALESCE($6, FALSE))
               ON CONFLICT (user_id, channel_id) DO UPDATE
               SET disabled_event_types = ARRAY(
                       SELECT unnest(s.disabled_event_types || $3::text[])
                       EXCEPT SELECT unnest($4::text[] || $5::text[])
                       ORDER BY 1),
                   enabled_event_types = ARRAY(
                       SELECT unnest(s.enabled_event_types || $4::text[])
                       EXCEPT SELECT unnest($3::text[] || $5::text[])
                       ORDER BY 1),
                   section_mute_override = COALESCE($6, s.section_mute_override),
                   updated_at = NOW()
               RETURNING disabled_event_types, enabled_event_types, section_mute_override"#,
            user.as_ref(),
            channel_id,
            &disable,
            &enable,
            &inherit,
            change.overrides_section_mute,
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(write_error)?;

        let updated = settings(
            row.disabled_event_types,
            row.enabled_event_types,
            row.section_mute_override,
        );

        if updated.is_empty() {
            sqlx::query!(
                "DELETE FROM user_channel_notification_setting WHERE user_id = $1 AND channel_id = $2",
                user.as_ref(),
                channel_id
            )
            .execute(&mut *tx)
            .await
            .map_err(write_error)?;
        }

        tx.commit().await.map_err(write_error)?;

        Ok(updated)
    }

    async fn reset(&self, user: MacroUserIdStr<'_>, channel_id: Uuid) -> Result<(), Report> {
        sqlx::query!(
            "DELETE FROM user_channel_notification_setting WHERE user_id = $1 AND channel_id = $2",
            user.as_ref(),
            channel_id
        )
        .execute(&self.0)
        .await?;
        Ok(())
    }
}

/// Each of the given users' own settings for a channel, for ingress. Users
/// without any are omitted.
pub(crate) async fn settings_for_recipients(
    pool: &PgPool,
    channel_id: Uuid,
    user_ids: &[MacroUserIdStr<'_>],
) -> Result<HashMap<MacroUserIdStr<'static>, ChannelNotificationSettings>, Report> {
    let ids: Vec<String> = user_ids.iter().map(|id| id.to_string()).collect();
    let rows = sqlx::query!(
        r#"SELECT user_id, disabled_event_types, enabled_event_types, section_mute_override
           FROM user_channel_notification_setting
           WHERE user_id = ANY($1) AND channel_id = $2"#,
        &ids,
        channel_id
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            let user_id = MacroUserIdStr::parse_from_str(&row.user_id)
                .map(CowLike::into_owned)
                .ok()?;
            let settings = settings(
                row.disabled_event_types,
                row.enabled_event_types,
                row.section_mute_override,
            );
            Some((user_id, settings))
        })
        .collect())
}

#[cfg(test)]
mod test;
