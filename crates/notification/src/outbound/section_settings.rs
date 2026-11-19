//! Postgres persistence for users' Chat section notification settings.

use crate::domain::section_settings::{
    ChannelSection, SectionMute, SectionNotificationSettings, SectionNotificationSettingsChange,
    SectionNotificationSettingsRepository, SectionSettingsWriteError,
};
use crate::outbound::channel_settings::{event_types, parse_kinds};
use chrono::{DateTime, Utc};
use cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use sqlx::PgPool;
use std::collections::{BTreeMap, HashMap};
use uuid::Uuid;

/// Postgres error code for a foreign key violation.
const FOREIGN_KEY_VIOLATION: &str = "23503";

const FAVORITES: &str = "favorites";
const DIRECT_MESSAGES: &str = "direct_messages";
const TEAM_CHANNELS: &str = "team_channels";

/// Adapter for the `user_channel_section_notification_setting` table.
#[derive(Clone)]
pub struct PgSectionNotificationSettingsRepository(pub PgPool);

/// The table's two section columns: a custom section's label, or a built-in
/// section's name.
fn section_columns(section: ChannelSection) -> (Option<Uuid>, Option<&'static str>) {
    match section {
        ChannelSection::Label { label_id } => (Some(label_id), None),
        ChannelSection::Favorites => (None, Some(FAVORITES)),
        ChannelSection::DirectMessages => (None, Some(DIRECT_MESSAGES)),
        ChannelSection::TeamChannels => (None, Some(TEAM_CHANNELS)),
    }
}

fn section_from_columns(label_id: Option<Uuid>, built_in: Option<&str>) -> Option<ChannelSection> {
    match (label_id, built_in) {
        (Some(label_id), _) => Some(ChannelSection::Label { label_id }),
        (None, Some(FAVORITES)) => Some(ChannelSection::Favorites),
        (None, Some(DIRECT_MESSAGES)) => Some(ChannelSection::DirectMessages),
        (None, Some(TEAM_CHANNELS)) => Some(ChannelSection::TeamChannels),
        (None, built_in) => {
            tracing::warn!(?built_in, "Skipping unknown section notification setting");
            None
        }
    }
}

fn mute_from_columns(muted: bool, snoozed_until: Option<DateTime<Utc>>) -> SectionMute {
    match (muted, snoozed_until) {
        (false, _) => SectionMute::Unmuted,
        (true, None) => SectionMute::Muted,
        (true, Some(until)) => SectionMute::Snoozed { until },
    }
}

fn write_error(error: sqlx::Error) -> SectionSettingsWriteError {
    let code = error.as_database_error().and_then(|error| error.code());
    if code.as_deref() == Some(FOREIGN_KEY_VIOLATION) {
        SectionSettingsWriteError::UnknownSection
    } else {
        SectionSettingsWriteError::Repository(error.into())
    }
}

impl SectionNotificationSettingsRepository for PgSectionNotificationSettingsRepository {
    async fn list(
        &self,
        user: MacroUserIdStr<'_>,
        now: DateTime<Utc>,
    ) -> Result<BTreeMap<ChannelSection, SectionNotificationSettings>, Report> {
        let rows = sqlx::query!(
            r#"SELECT label_id, built_in_section, disabled_event_types, muted, snoozed_until
               FROM user_channel_section_notification_setting
               WHERE user_id = $1"#,
            user.as_ref()
        )
        .fetch_all(&self.0)
        .await?;

        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let section = section_from_columns(row.label_id, row.built_in_section.as_deref())?;
                let settings = SectionNotificationSettings {
                    disabled: parse_kinds(row.disabled_event_types),
                    mute: mute_from_columns(row.muted, row.snoozed_until).at(now),
                };
                Some((section, settings))
            })
            .filter(|(_, settings)| !settings.is_empty())
            .collect())
    }

    async fn update(
        &self,
        user: MacroUserIdStr<'_>,
        section: ChannelSection,
        change: &SectionNotificationSettingsChange,
    ) -> Result<SectionNotificationSettings, SectionSettingsWriteError> {
        let (label_id, built_in) = section_columns(section);
        let enable = event_types(&change.enable);
        let disable = event_types(&change.disable);
        let (muted, snoozed_until) = match change.mute {
            None => (None, None),
            Some(SectionMute::Unmuted) => (Some(false), None),
            Some(SectionMute::Muted) => (Some(true), None),
            Some(SectionMute::Snoozed { until }) => (Some(true), Some(until)),
        };
        let mut tx = self.0.begin().await.map_err(write_error)?;

        // The upsert locks the row, so concurrent changes to one section
        // apply one after the other. A row is left with nothing set only
        // inside this transaction: it is deleted before commit.
        let row = sqlx::query!(
            r#"INSERT INTO user_channel_section_notification_setting AS s
                   (user_id, label_id, built_in_section, disabled_event_types, muted,
                    snoozed_until)
               VALUES ($1, $2, $3, ARRAY(SELECT unnest($4::text[]) ORDER BY 1),
                       COALESCE($6, FALSE), $7)
               ON CONFLICT (user_id, section_key) DO UPDATE
               SET disabled_event_types = ARRAY(
                       SELECT unnest(s.disabled_event_types || $4::text[])
                       EXCEPT SELECT unnest($5::text[])
                       ORDER BY 1),
                   muted = COALESCE($6, s.muted),
                   snoozed_until = CASE WHEN $6::boolean IS NULL THEN s.snoozed_until ELSE $7 END,
                   updated_at = NOW()
               RETURNING disabled_event_types, muted, snoozed_until"#,
            user.as_ref(),
            label_id,
            built_in,
            &disable,
            &enable,
            muted,
            snoozed_until,
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(write_error)?;

        let updated = SectionNotificationSettings {
            disabled: parse_kinds(row.disabled_event_types),
            mute: mute_from_columns(row.muted, row.snoozed_until),
        };

        if updated.is_empty() {
            sqlx::query!(
                r#"DELETE FROM user_channel_section_notification_setting
                   WHERE user_id = $1
                     AND section_key = COALESCE('label:' || $2::uuid::text, $3)"#,
                user.as_ref(),
                label_id,
                built_in,
            )
            .execute(&mut *tx)
            .await
            .map_err(write_error)?;
        }

        tx.commit().await.map_err(write_error)?;

        Ok(updated)
    }
}

/// Each of the given users' section settings, for ingress. Users without any
/// are omitted; snoozes are returned as stored, ended or not.
pub(crate) async fn section_settings_for_recipients(
    pool: &PgPool,
    user_ids: &[MacroUserIdStr<'_>],
) -> Result<
    HashMap<MacroUserIdStr<'static>, BTreeMap<ChannelSection, SectionNotificationSettings>>,
    Report,
> {
    let ids: Vec<String> = user_ids.iter().map(|id| id.to_string()).collect();
    let rows = sqlx::query!(
        r#"SELECT user_id, label_id, built_in_section, disabled_event_types, muted, snoozed_until
           FROM user_channel_section_notification_setting
           WHERE user_id = ANY($1)"#,
        &ids,
    )
    .fetch_all(pool)
    .await?;

    let mut settings: HashMap<_, BTreeMap<_, _>> = HashMap::new();
    for row in rows {
        let Ok(user_id) = MacroUserIdStr::parse_from_str(&row.user_id).map(CowLike::into_owned)
        else {
            continue;
        };
        let Some(section) = section_from_columns(row.label_id, row.built_in_section.as_deref())
        else {
            continue;
        };

        settings.entry(user_id).or_default().insert(
            section,
            SectionNotificationSettings {
                disabled: parse_kinds(row.disabled_event_types),
                mute: mute_from_columns(row.muted, row.snoozed_until),
            },
        );
    }

    Ok(settings)
}

#[cfg(test)]
mod test;
