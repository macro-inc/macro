//! PostgreSQL facts for source-scoped team reads.
//!
//! Only directly owned/delegated Google sources enter these queries. Neither
//! channel grants nor team-derived grants can recursively expand access.

use crate::domain::{
    models::{CalendarEvent, CalendarEventOverride, OccurrenceRange},
    team::*,
};
use rootcause::Report;
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

mod ooo;
pub(super) use ooo::list_team_out_of_office;

/// PostgreSQL implementation of the team-calendar repository.
pub struct PgCalendarTeamRepository {
    pool: PgPool,
}
impl PgCalendarTeamRepository {
    /// Construct the source repository from the primary database pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceSnapshot {
    event: CalendarEvent,
    overrides: Vec<CalendarEventOverride>,
}

fn sharing(value: &str) -> Result<TeamCalendarSharing, Report> {
    match value {
        "all" => Ok(TeamCalendarSharing::All),
        "busy_only" => Ok(TeamCalendarSharing::BusyOnly),
        "none" => Ok(TeamCalendarSharing::None),
        _ => Err(rootcause::report!("invalid stored calendar sharing policy")),
    }
}

impl CalendarTeamRepository for PgCalendarTeamRepository {
    async fn projection_revision(&self, requester: &str) -> Result<String, Report> {
        sqlx::query_scalar!(r#"
            WITH members AS (
                SELECT teammate.user_id FROM team_user viewer JOIN team_user teammate ON teammate.team_id = viewer.team_id WHERE viewer.user_id = $1
                UNION SELECT $1::text
            )
            SELECT md5(COALESCE(string_agg(jsonb_build_array(members.user_id, policy.sharing, policy.updated_at,
                account.id, account.sync_status IN ('ready','syncing'), account.last_sync_error IS NULL,
                COALESCE(account.last_synced_at > now() - interval '15 minutes', false), calendar.id, calendar.access_role,
                calendar.synced_at IS NULL, calendar.snapshot_normalization_version, calendar.is_deleted, calendar.is_primary, calendar.name, calendar.time_zone,
                calendar.last_sync_error IS NULL, calendar.materialized_starts_at, calendar.materialized_ends_at,
                calendar.materialized_start_date, calendar.materialized_end_date,
                preference.contributes_to_availability, counter.seq)::text, '|' ORDER BY members.user_id, account.id, calendar.id), '')) AS "revision!"
            FROM members LEFT JOIN calendar_team_sharing policy ON policy.user_id = members.user_id
            LEFT JOIN calendar_accounts account ON (account.owner_id = members.user_id OR EXISTS (
                SELECT 1 FROM macro_user_links link WHERE link.link_id = account.email_link_id AND link.primary_macro_id = members.user_id
            ))
            LEFT JOIN calendars calendar ON calendar.account_id = account.id
            LEFT JOIN calendar_availability_preferences preference ON preference.calendar_id = calendar.id AND preference.user_id = members.user_id
            LEFT JOIN calendar_change_counters counter ON counter.link_id = account.email_link_id
        "#, requester).fetch_one(&self.pool).await.map_err(|error| rootcause::report!(error).into())
    }
    async fn members(
        &self,
        requester: &str,
        include_self: bool,
        range: &OccurrenceRange,
    ) -> Result<Vec<TeamCalendarMember>, Report> {
        let rows = sqlx::query!(r#"
            WITH members AS (
                SELECT teammate.user_id
                FROM team_user viewer JOIN team_user teammate ON teammate.team_id = viewer.team_id
                WHERE viewer.user_id = $1 AND teammate.user_id <> $1
                UNION SELECT $1::text WHERE $2
            ), visible_accounts AS MATERIALIZED (
                SELECT members.user_id, account.id AS account_id
                FROM members JOIN calendar_accounts account ON account.owner_id = members.user_id
                WHERE account.sync_status <> 'disabled'
                UNION
                SELECT members.user_id, account.id AS account_id
                FROM members
                JOIN macro_user_links link ON link.primary_macro_id = members.user_id
                JOIN calendar_accounts account ON account.email_link_id = link.link_id
                WHERE account.sync_status <> 'disabled'
            )
            SELECT members.user_id AS "user_id!",
                COALESCE(policy.sharing, 'busy_only') AS "sharing!",
                COALESCE(bool_and(
                    account.sync_status IN ('ready', 'syncing') AND account.last_sync_error IS NULL
                    AND COALESCE(account.last_synced_at > now() - interval '15 minutes', false)
                    AND calendar.last_sync_error IS NULL
                    AND COALESCE(calendar.materialized_starts_at <= $3 AND calendar.materialized_ends_at >= $4
                        AND calendar.materialized_start_date <= $5 AND calendar.materialized_end_date >= $6, false)
                    AND calendar.synced_at IS NOT NULL AND calendar.snapshot_normalization_version >= 1
                    AND NOT EXISTS (
                        SELECT 1 FROM calendar_event_sources pending_source
                        WHERE pending_source.calendar_id = calendar.id
                          AND (pending_source.provider_access_role IS NULL
                            OR pending_source.provider_access_role IS DISTINCT FROM calendar.access_role)
                    )
                ), false) AS "ready!"
            FROM members LEFT JOIN calendar_team_sharing policy ON policy.user_id = members.user_id
            LEFT JOIN visible_accounts visible ON visible.user_id = members.user_id
            LEFT JOIN calendar_accounts account ON account.id = visible.account_id
            LEFT JOIN calendars calendar ON calendar.account_id = account.id AND NOT calendar.is_deleted
            GROUP BY members.user_id, policy.sharing
            ORDER BY members.user_id
        "#, requester, include_self, range.starts_at, range.ends_at, range.start_date, range.end_date).fetch_all(&self.pool).await.map_err(|error| rootcause::report!(error))?;
        rows.into_iter()
            .map(|row| {
                let policy = if row.user_id == requester {
                    TeamCalendarSharing::All
                } else {
                    sharing(&row.sharing)?
                };
                Ok(TeamCalendarMember {
                    user_id: row.user_id,
                    sharing: policy,
                    coverage: if policy == TeamCalendarSharing::None {
                        TeamCalendarCoverage::Hidden
                    } else if row.ready {
                        TeamCalendarCoverage::Ready
                    } else {
                        TeamCalendarCoverage::Unavailable
                    },
                })
            })
            .collect()
    }

    async fn sources(
        &self,
        requester: &str,
        range: OccurrenceRange,
        owners: &[String],
        cursor: Option<&TeamCalendarCursor>,
        limit: u32,
    ) -> Result<Vec<TeamSourceOccurrence>, Report> {
        // The normalized source payload holds this source's schedule, guests,
        // conference, and exceptions. Joining canonical entity fields here would
        // borrow richer content from a different calendar's entitlement.
        let rows = sqlx::query!(r#"
            WITH eligible AS (
                SELECT teammate.user_id FROM team_user viewer
                JOIN team_user teammate ON teammate.team_id = viewer.team_id
                LEFT JOIN calendar_team_sharing policy ON policy.user_id = teammate.user_id
                WHERE viewer.user_id = $1 AND COALESCE(policy.sharing, 'busy_only') <> 'none'
                UNION SELECT $1::text
            ), visible_accounts AS MATERIALIZED (
                SELECT eligible.user_id, account.id AS account_id
                FROM eligible JOIN calendar_accounts account ON account.owner_id = eligible.user_id
                WHERE eligible.user_id = ANY($2::text[])
                UNION
                SELECT eligible.user_id, account.id AS account_id
                FROM eligible
                JOIN macro_user_links link ON link.primary_macro_id = eligible.user_id
                JOIN calendar_accounts account ON account.email_link_id = link.link_id
                WHERE eligible.user_id = ANY($2::text[])
            ), authorized_sources AS MATERIALIZED (
                SELECT eligible.user_id AS shared_by, source.id AS source_id,
                    calendar.id AS calendar_id, calendar.name AS calendar_name, calendar.time_zone,
                    COALESCE(preference.contributes_to_availability,
                        account.owner_id = eligible.user_id AND calendar.is_primary) AS contributes,
                    source.normalized_payload
                FROM visible_accounts eligible
                JOIN calendar_accounts account ON account.id = eligible.account_id
                  AND account.sync_status IN ('ready', 'syncing')
                  AND account.last_sync_error IS NULL
                  AND account.last_synced_at > now() - interval '15 minutes'
                JOIN calendars calendar ON calendar.account_id = account.id AND NOT calendar.is_deleted
                  AND calendar.synced_at IS NOT NULL AND calendar.last_sync_error IS NULL
                  AND calendar.snapshot_normalization_version >= 1
                JOIN calendar_event_sources source ON source.calendar_id = calendar.id AND source.account_id = account.id
                  AND source.provider_access_role IS NOT NULL
                  AND source.provider_access_role IS NOT DISTINCT FROM calendar.access_role
                LEFT JOIN calendar_availability_preferences preference ON preference.user_id = eligible.user_id AND preference.calendar_id = calendar.id
                WHERE ($7::text IS NULL OR (eligible.user_id, source.id) >= ($7,$8))
            )
            SELECT shared_by AS "shared_by!", source_id AS "source_id!",
                calendar_id AS "calendar_id!", calendar_name AS "calendar_name!", time_zone,
                contributes AS "contributes!",
                ARRAY(SELECT owned.email_address::text FROM email_links owned WHERE owned.macro_id = shared_by) AS "owner_emails!",
                (normalized_payload - 'occurrences') AS "snapshot!", occurrence.value AS "occurrence!"
            FROM authorized_sources
            CROSS JOIN LATERAL jsonb_array_elements(normalized_payload->'occurrences') occurrence(value)
            WHERE (normalized_payload->'event'->>'status') <> 'cancelled'
              AND NOT COALESCE((occurrence.value->>'isCancelled')::boolean, false)
              AND (
                ((occurrence.value->'time'->>'kind') = 'timed'
                  AND (occurrence.value->'time'->>'startsAt')::timestamptz < $4
                  AND ((occurrence.value->'time'->>'endsAt')::timestamptz > $3
                    OR ((occurrence.value->'time'->>'startsAt')::timestamptz = (occurrence.value->'time'->>'endsAt')::timestamptz
                      AND (occurrence.value->'time'->>'startsAt')::timestamptz >= $3)))
                OR ((occurrence.value->'time'->>'kind') = 'allDay'
                  AND (occurrence.value->'time'->>'startDate')::date < $6
                  AND (occurrence.value->'time'->>'endDate')::date > $5)
              )
              AND ($7::text IS NULL OR (shared_by, source_id, occurrence.value->>'occurrenceKey') > ($7,$8,$9))
            ORDER BY shared_by, source_id, occurrence.value->>'occurrenceKey'
            LIMIT $10
        "#, requester, owners, range.starts_at, range.ends_at, range.start_date, range.end_date,
            cursor.map(|cursor| cursor.user_id.as_str()), cursor.map(|cursor| cursor.source_id), cursor.map(|cursor| cursor.occurrence_key.as_str()), i64::from(limit))
            .fetch_all(&self.pool).await.map_err(|error| rootcause::report!(error))?;
        rows.into_iter()
            .map(|row| {
                let snapshot: SourceSnapshot = serde_json::from_value(row.snapshot)
                    .map_err(|error| rootcause::report!(error))?;
                Ok(TeamSourceOccurrence {
                    shared_by: row.shared_by,
                    source_id: row.source_id,
                    calendar_id: row.calendar_id,
                    calendar_name: row.calendar_name,
                    calendar_time_zone: row.time_zone,
                    contributes_to_availability: row.contributes,
                    owner_emails: row.owner_emails,
                    event: snapshot.event,
                    overrides: snapshot.overrides,
                    occurrence: serde_json::from_value(row.occurrence)
                        .map_err(|error| rootcause::report!(error))?,
                })
            })
            .collect()
    }

    async fn owned_emails(&self, requester: &str) -> Result<Vec<String>, Report> {
        sqlx::query_scalar!(
            r#"SELECT email_address::text AS "email!" FROM email_links WHERE macro_id = $1"#,
            requester
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| rootcause::report!(error).into())
    }

    async fn sharing(&self, requester: &str) -> Result<TeamCalendarSharing, Report> {
        let value = sqlx::query_scalar!(
            "SELECT sharing FROM calendar_team_sharing WHERE user_id = $1",
            requester
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| rootcause::report!(error))?;
        sharing(value.as_deref().unwrap_or("busy_only"))
    }

    async fn set_sharing(
        &self,
        requester: &str,
        policy: TeamCalendarSharing,
    ) -> Result<(), Report> {
        sqlx::query!(
            r#"INSERT INTO calendar_team_sharing(user_id,sharing) VALUES($1,$2)
            ON CONFLICT(user_id) DO UPDATE SET sharing=EXCLUDED.sharing, updated_at=now()"#,
            requester,
            policy.as_str()
        )
        .execute(&self.pool)
        .await
        .map_err(|error| rootcause::report!(error))?;
        Ok(())
    }

    async fn availability_calendars(
        &self,
        requester: &str,
    ) -> Result<Vec<AvailabilityCalendar>, Report> {
        let rows = sqlx::query!(r#"
            SELECT calendar.id, calendar.name, calendar.is_primary,
                COALESCE(preference.contributes_to_availability,
                    account.owner_id = $1 AND calendar.is_primary) AS "contributes!"
            FROM calendars calendar JOIN calendar_accounts account ON account.id = calendar.account_id
            LEFT JOIN calendar_availability_preferences preference ON preference.calendar_id = calendar.id AND preference.user_id = $1
            WHERE NOT calendar.is_deleted AND account.sync_status <> 'disabled'
              AND (account.owner_id = $1 OR EXISTS (SELECT 1 FROM macro_user_links link WHERE link.link_id = account.email_link_id AND link.primary_macro_id = $1))
            ORDER BY calendar.name, calendar.id
        "#, requester).fetch_all(&self.pool).await.map_err(|error| rootcause::report!(error))?;
        Ok(rows
            .into_iter()
            .map(|row| AvailabilityCalendar {
                calendar_id: row.id,
                name: row.name,
                is_primary: row.is_primary,
                contributes_to_availability: row.contributes,
            })
            .collect())
    }

    async fn set_availability_calendar(
        &self,
        requester: &str,
        calendar: Uuid,
        contributes: bool,
    ) -> Result<bool, Report> {
        let result = sqlx::query!(r#"
            INSERT INTO calendar_availability_preferences(user_id,calendar_id,contributes_to_availability)
            SELECT $1, calendar.id, $3 FROM calendars calendar
            JOIN calendar_accounts account ON account.id = calendar.account_id
            WHERE calendar.id = $2 AND NOT calendar.is_deleted AND account.sync_status <> 'disabled'
              AND (account.owner_id = $1 OR EXISTS (SELECT 1 FROM macro_user_links link WHERE link.link_id = account.email_link_id AND link.primary_macro_id = $1))
            ON CONFLICT(user_id,calendar_id) DO UPDATE SET contributes_to_availability=EXCLUDED.contributes_to_availability
        "#, requester, calendar, contributes).execute(&self.pool).await.map_err(|error| rootcause::report!(error))?;
        Ok(result.rows_affected() == 1)
    }
}
