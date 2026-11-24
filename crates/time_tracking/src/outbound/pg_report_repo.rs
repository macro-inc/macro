//! Postgres reads behind reports over logged time.
//!
//! Each read runs in its own transaction under a five-second statement
//! timeout, since what it costs depends on how much time a team logged.
//! [`ReportRead::Latest`] reads the primary; [`ReportRead::MayLag`] reads the
//! replica, which can be seconds behind.

#[cfg(test)]
mod test;

use chrono::NaiveDate;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::{PgPool, Postgres, Transaction};

use crate::domain::{
    models::TimeEntrySource,
    ports::{ReportFilter, ReportRead, TimeReportRepository},
    report::{ExportEntry, SummarySum, TimeBreakdown, TimeGroupKey, TimeGrouping, TimePeriod},
};

/// Errors from the Postgres report repository.
#[derive(Debug, thiserror::Error)]
pub enum PgTimeReportError {
    /// A query failed or passed the statement timeout.
    #[error("time report query failed: {0}")]
    Database(#[from] sqlx::Error),
    /// A stored row breaks the domain's types.
    #[error("invalid stored time report row: {0}")]
    InvalidRow(String),
}

/// Postgres implementation of [`TimeReportRepository`].
#[derive(Clone)]
pub struct PgTimeReportRepository {
    primary: PgPool,
    replica: PgPool,
}

impl PgTimeReportRepository {
    /// Reads over the primary, and over the replica where they may lag.
    pub fn new(primary: PgPool, replica: PgPool) -> Self {
        Self { primary, replica }
    }

    async fn begin(
        &self,
        read: ReportRead,
    ) -> Result<Transaction<'static, Postgres>, PgTimeReportError> {
        let pool = match read {
            ReportRead::Latest => &self.primary,
            ReportRead::MayLag => &self.replica,
        };
        let mut tx = pool.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *tx)
            .await?;
        Ok(tx)
    }
}

fn grouping_name(grouping: TimeGrouping) -> &'static str {
    match grouping {
        TimeGrouping::Person => "person",
        TimeGrouping::Task => "task",
        TimeGrouping::Day => "day",
    }
}

fn user_ids(people: &[MacroUserIdStr<'static>]) -> Vec<String> {
    people
        .iter()
        .map(|person| person.as_ref().to_owned())
        .collect()
}

fn parse_user(id: &str) -> Result<MacroUserIdStr<'static>, PgTimeReportError> {
    MacroUserIdStr::parse_from_str(id)
        .map(CowLike::into_owned)
        .map_err(|_| PgTimeReportError::InvalidRow(format!("user id {id}")))
}

fn count(value: i64, what: &str) -> Result<u32, PgTimeReportError> {
    u32::try_from(value).map_err(|_| PgTimeReportError::InvalidRow(format!("{what} {value}")))
}

/// One row of the summary statements.
struct SumRow {
    in_group: bool,
    in_then: bool,
    group_user: Option<String>,
    group_task: Option<String>,
    group_day: Option<NaiveDate>,
    then_user: Option<String>,
    then_task: Option<String>,
    then_day: Option<NaiveDate>,
    minutes: i64,
    task_count: i64,
}

fn key(
    grouping: TimeGrouping,
    user: Option<String>,
    task: Option<String>,
    day: Option<NaiveDate>,
) -> Result<TimeGroupKey, PgTimeReportError> {
    let missing = || PgTimeReportError::InvalidRow(format!("{grouping:?} key missing"));
    Ok(match grouping {
        TimeGrouping::Person => TimeGroupKey::Person {
            user_id: parse_user(&user.ok_or_else(missing)?)?,
        },
        TimeGrouping::Task => TimeGroupKey::Task {
            task_id: task.ok_or_else(missing)?,
        },
        TimeGrouping::Day => TimeGroupKey::Day {
            date: day.ok_or_else(missing)?,
        },
    })
}

fn sum_from(
    row: SumRow,
    breakdown: TimeBreakdown,
) -> Result<Option<SummarySum>, PgTimeReportError> {
    let minutes = count(row.minutes, "minutes")?;
    let task_count = count(row.task_count, "task count")?;
    let group = |row: &SumRow| {
        key(
            breakdown.group_by(),
            row.group_user.clone(),
            row.group_task.clone(),
            row.group_day,
        )
    };
    Ok(match (row.in_group, row.in_then, breakdown.then_by()) {
        (false, false, _) => Some(SummarySum::Total {
            minutes,
            task_count,
        }),
        (true, false, _) => Some(SummarySum::Group {
            key: group(&row)?,
            minutes,
            task_count,
        }),
        // Without a second grouping its sets repeat the first's.
        (_, true, None) => None,
        (true, true, Some(then_by)) => Some(SummarySum::Row {
            group: group(&row)?,
            key: key(then_by, row.then_user, row.then_task, row.then_day)?,
            minutes,
        }),
        (false, true, Some(then_by)) => Some(SummarySum::ThenTotal {
            key: key(then_by, row.then_user, row.then_task, row.then_day)?,
            minutes,
        }),
    })
}

/// One row of the export statements.
struct ExportRow {
    entry_date: NaiveDate,
    user_id: String,
    task_name: String,
    minutes: i32,
    note: Option<String>,
    source: TimeEntrySource,
}

impl TryFrom<ExportRow> for ExportEntry {
    type Error = PgTimeReportError;

    fn try_from(row: ExportRow) -> Result<Self, Self::Error> {
        Ok(ExportEntry {
            date: row.entry_date,
            user_id: parse_user(&row.user_id)?,
            task_name: row.task_name,
            minutes: u16::try_from(row.minutes)
                .map_err(|_| PgTimeReportError::InvalidRow(format!("minutes {}", row.minutes)))?,
            note: row.note,
            source: row.source,
        })
    }
}

impl TimeReportRepository for PgTimeReportRepository {
    type Err = PgTimeReportError;

    #[tracing::instrument(
        name = "time.read_team_members",
        skip_all,
        fields(read = ?read, members = tracing::field::Empty),
        err
    )]
    async fn team_members(
        &self,
        user_id: &MacroUserIdStr<'static>,
        read: ReportRead,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Self::Err> {
        let mut tx = self.begin(read).await?;
        let rows = sqlx::query_scalar!(
            r#"
            SELECT teammate.user_id AS "user_id!"
            FROM team_user viewer
            JOIN team_user teammate ON teammate.team_id = viewer.team_id
            WHERE viewer.user_id = $1
            UNION
            SELECT $1::text
            ORDER BY 1
            "#,
            user_id.as_ref(),
        )
        .fetch_all(&mut *tx)
        .await?;
        tx.commit().await?;
        tracing::Span::current().record("members", rows.len());
        rows.iter().map(|id| parse_user(id)).collect()
    }

    #[tracing::instrument(
        name = "time.read_people_tasks",
        skip_all,
        fields(read = ?read, people = people.len(), tasks = tracing::field::Empty),
        err
    )]
    async fn people_task_ids(
        &self,
        people: &[MacroUserIdStr<'static>],
        period: TimePeriod,
        limit: u16,
        read: ReportRead,
    ) -> Result<Vec<String>, Self::Err> {
        let mut tx = self.begin(read).await?;
        let rows = sqlx::query_scalar!(
            r#"
            SELECT DISTINCT task_id
            FROM time_entry
            WHERE user_id = ANY($1::text[])
              AND entry_date BETWEEN $2 AND $3
            ORDER BY task_id
            LIMIT $4
            "#,
            &user_ids(people),
            period.from(),
            period.to(),
            i64::from(limit),
        )
        .fetch_all(&mut *tx)
        .await?;
        tx.commit().await?;
        tracing::Span::current().record("tasks", rows.len());
        Ok(rows)
    }

    #[tracing::instrument(
        name = "time.count_live_tasks",
        skip_all,
        fields(read = ?read, tasks = task_ids.len()),
        err
    )]
    async fn live_task_count(
        &self,
        task_ids: &[String],
        read: ReportRead,
    ) -> Result<u32, Self::Err> {
        let mut tx = self.begin(read).await?;
        let live = sqlx::query_scalar!(
            r#"
            SELECT count(*) AS "count!"
            FROM "Document"
            WHERE id = ANY($1::text[])
              AND "deletedAt" IS NULL
            "#,
            task_ids,
        )
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        count(live, "live tasks")
    }

    #[tracing::instrument(
        name = "time.read_summary",
        skip_all,
        fields(
            read = ?read,
            tasks = filter.task_ids.len(),
            people = filter.people.map(<[_]>::len),
            rows = tracing::field::Empty,
        ),
        err
    )]
    async fn summary_sums(
        &self,
        filter: ReportFilter<'_>,
        breakdown: TimeBreakdown,
        read: ReportRead,
    ) -> Result<Vec<SummarySum>, Self::Err> {
        let group_by = grouping_name(breakdown.group_by());
        let then_by = breakdown.then_by().map(grouping_name);
        let mut tx = self.begin(read).await?;
        let rows = match filter.people {
            None => {
                sqlx::query_file_as!(
                    SumRow,
                    "src/outbound/pg_report_repo/summary_of_tasks.sql",
                    filter.task_ids,
                    filter.period.from(),
                    filter.period.to(),
                    group_by,
                    then_by,
                )
                .fetch_all(&mut *tx)
                .await?
            }
            Some(people) => {
                sqlx::query_file_as!(
                    SumRow,
                    "src/outbound/pg_report_repo/summary_of_people.sql",
                    filter.task_ids,
                    filter.period.from(),
                    filter.period.to(),
                    group_by,
                    then_by,
                    &user_ids(people),
                )
                .fetch_all(&mut *tx)
                .await?
            }
        };
        tx.commit().await?;
        tracing::Span::current().record("rows", rows.len());
        let mut sums = Vec::with_capacity(rows.len());
        for row in rows {
            if let Some(sum) = sum_from(row, breakdown)? {
                sums.push(sum);
            }
        }
        Ok(sums)
    }

    #[tracing::instrument(
        name = "time.read_export",
        skip_all,
        fields(
            read = ?read,
            tasks = filter.task_ids.len(),
            people = filter.people.map(<[_]>::len),
            rows = tracing::field::Empty,
        ),
        err
    )]
    async fn export_entries(
        &self,
        filter: ReportFilter<'_>,
        limit: u16,
        read: ReportRead,
    ) -> Result<Vec<ExportEntry>, Self::Err> {
        let mut tx = self.begin(read).await?;
        let rows = match filter.people {
            None => {
                sqlx::query_as!(
                    ExportRow,
                    r#"
                    SELECT e.entry_date, e.user_id, d.name AS task_name, e.minutes, e.note,
                           e.source AS "source: TimeEntrySource"
                    FROM time_entry e
                    JOIN "Document" d ON d.id = e.task_id
                    WHERE e.task_id = ANY($1::text[])
                      AND e.entry_date BETWEEN $2 AND $3
                      AND d."deletedAt" IS NULL
                    ORDER BY e.entry_date, e.id
                    LIMIT $4
                    "#,
                    filter.task_ids,
                    filter.period.from(),
                    filter.period.to(),
                    i64::from(limit),
                )
                .fetch_all(&mut *tx)
                .await?
            }
            Some(people) => {
                sqlx::query_as!(
                    ExportRow,
                    r#"
                    SELECT e.entry_date, e.user_id, d.name AS task_name, e.minutes, e.note,
                           e.source AS "source: TimeEntrySource"
                    FROM time_entry e
                    JOIN "Document" d ON d.id = e.task_id
                    WHERE e.task_id = ANY($1::text[])
                      AND e.user_id = ANY($5::text[])
                      AND e.entry_date BETWEEN $2 AND $3
                      AND d."deletedAt" IS NULL
                    ORDER BY e.entry_date, e.id
                    LIMIT $4
                    "#,
                    filter.task_ids,
                    filter.period.from(),
                    filter.period.to(),
                    i64::from(limit),
                    &user_ids(people),
                )
                .fetch_all(&mut *tx)
                .await?
            }
        };
        tx.commit().await?;
        tracing::Span::current().record("rows", rows.len());
        rows.into_iter().map(ExportEntry::try_from).collect()
    }
}
