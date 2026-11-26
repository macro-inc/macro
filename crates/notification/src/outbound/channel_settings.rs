//! Postgres persistence for users' per-channel notification settings.

use crate::domain::channel_settings::{
    ChannelKindsChange, ChannelNotificationKind, ChannelNotificationSettings,
    ChannelNotificationSettingsChange, ChannelNotificationSettingsRepository,
    ChannelSettingsWriteError,
};
use cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use sqlx::PgPool;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use strum::IntoEnumIterator;
use uuid::Uuid;

/// Postgres error code for a foreign key violation.
const FOREIGN_KEY_VIOLATION: &str = "23503";

/// Adapter for the `user_channel_notification_setting` table.
#[derive(Clone)]
pub struct PgChannelNotificationSettingsRepository(pub PgPool);

/// Parse stored event types, skipping any this build does not know.
pub(crate) fn parse_kinds(event_types: Vec<String>) -> BTreeSet<ChannelNotificationKind> {
    event_types
        .into_iter()
        .filter_map(|event_type| {
            event_type
                .parse()
                .inspect_err(|_| {
                    tracing::warn!(event_type, "Skipping unknown notification setting");
                })
                .ok()
        })
        .collect()
}

/// Event types in their stored form.
pub(crate) fn event_types(kinds: &BTreeSet<ChannelNotificationKind>) -> Vec<String> {
    kinds
        .iter()
        .map(|kind| <&'static str>::from(*kind).to_owned())
        .collect()
}

/// The table stores the kinds a channel's own settings turn off, so a kind
/// added later is on, as everywhere else.
fn settings(
    disabled: Option<Vec<String>>,
    overrides_section_mute: bool,
) -> ChannelNotificationSettings {
    let enabled = disabled.map(|disabled| {
        let disabled = parse_kinds(disabled);
        ChannelNotificationKind::iter()
            .filter(|kind| !disabled.contains(kind))
            .collect()
    });
    ChannelNotificationSettings {
        enabled,
        overrides_section_mute,
    }
}

/// Drop a legacy mentions-only preference on the channel, which its
/// notification settings replace.
async fn drop_legacy_mentions_only(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user: &MacroUserIdStr<'_>,
    channel_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"DELETE FROM user_notification_item_unsubscribe
           WHERE user_id = $1 AND item_id = $2 AND mentions_only"#,
        user.as_ref(),
        channel_id.to_string()
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
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
            r#"SELECT channel_id, disabled_event_types, section_mute_override
               FROM user_channel_notification_setting
               WHERE user_id = $1"#,
            user.as_ref()
        )
        .fetch_all(&self.0)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| {
                let settings = settings(row.disabled_event_types, row.section_mute_override);
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
        let changes_kinds = change.kinds != ChannelKindsChange::Keep;
        let disabled = match &change.kinds {
            ChannelKindsChange::Set(enabled) => Some(event_types(
                &ChannelNotificationKind::iter()
                    .filter(|kind| !enabled.contains(kind))
                    .collect(),
            )),
            ChannelKindsChange::Keep | ChannelKindsChange::Inherit => None,
        };
        let mut tx = self.0.begin().await.map_err(write_error)?;

        // The upsert locks the row, so concurrent changes to one channel
        // apply one after the other. A row is left with no settings only
        // inside this transaction: it is deleted before commit.
        let row = sqlx::query!(
            r#"INSERT INTO user_channel_notification_setting AS s
                   (user_id, channel_id, disabled_event_types, section_mute_override)
               VALUES ($1, $2, $3::text[], COALESCE($5, FALSE))
               ON CONFLICT (user_id, channel_id) DO UPDATE
               SET disabled_event_types = CASE WHEN $4 THEN EXCLUDED.disabled_event_types
                                               ELSE s.disabled_event_types END,
                   section_mute_override = COALESCE($5, s.section_mute_override),
                   updated_at = NOW()
               RETURNING disabled_event_types, section_mute_override"#,
            user.as_ref(),
            channel_id,
            disabled.as_deref(),
            changes_kinds,
            change.overrides_section_mute,
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(write_error)?;

        if changes_kinds {
            drop_legacy_mentions_only(&mut tx, &user, channel_id)
                .await
                .map_err(write_error)?;
        }

        let updated = settings(row.disabled_event_types, row.section_mute_override);

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
        let mut tx = self.0.begin().await?;
        sqlx::query!(
            "DELETE FROM user_channel_notification_setting WHERE user_id = $1 AND channel_id = $2",
            user.as_ref(),
            channel_id
        )
        .execute(&mut *tx)
        .await?;
        drop_legacy_mentions_only(&mut tx, &user, channel_id).await?;
        tx.commit().await?;
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
        r#"SELECT user_id, disabled_event_types, section_mute_override
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
            let settings = settings(row.disabled_event_types, row.section_mute_override);
            Some((user_id, settings))
        })
        .collect())
}

#[cfg(test)]
mod test;
