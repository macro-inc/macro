use std::{
    convert::Infallible,
    sync::{Arc, Mutex},
};

use chrono::NaiveDate;
use entity_access::domain::models::{AccessLevel, Entity, EntityAccessReceipt, EntityPermission};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

use super::*;
use crate::{
    domain::{
        ports::ReportFilter,
        report::{ExportEntry, ReportTask, SummarySum, TimeGroupKey, TimeGrouping},
    },
    outbound::pg_report_repo::PgTimeReportRepository,
    test_support::{FakeAccess, user},
};

const AUTHOR: &str = "macro|author@example.com";
const EDITOR: &str = "macro|editor@example.com";
const VIEWER: &str = "macro|viewer@example.com";
const QUIET: &str = "macro|quiet@example.com";
const OUTSIDER: &str = "macro|outsider@example.com";
const FORMER: &str = "macro|former@example.com";
const BRIEF: &str = "00000000-0000-0000-0000-0000000000a1";
const REVIEW: &str = "00000000-0000-0000-0000-0000000000a2";
const HIDDEN: &str = "00000000-0000-0000-0000-0000000000a3";
const TRASHED: &str = "00000000-0000-0000-0000-0000000000c1";
const PROJECT: &str = "01a1fa5b-0000-7000-8000-000000000001";

/// A project's tasks as a fixed list.
#[derive(Clone, Default)]
struct FakeProjects(Vec<String>);

impl ProjectTasks for FakeProjects {
    type Err = Infallible;

    async fn project_task_ids(
        &self,
        _project_id: Uuid,
        limit: u16,
    ) -> Result<Vec<String>, Self::Err> {
        Ok(self.0.iter().take(usize::from(limit)).cloned().collect())
    }
}

fn day(date: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 11, date).unwrap()
}

fn november() -> TimePeriod {
    TimePeriod::new(day(1), day(30)).unwrap()
}

fn by_person() -> TimeBreakdown {
    TimeBreakdown::new(TimeGrouping::Person, Some(TimeGrouping::Task)).unwrap()
}

fn person(id: &str) -> TimeGroupKey {
    TimeGroupKey::Person { user_id: user(id) }
}

fn task(id: &str) -> TimeGroupKey {
    TimeGroupKey::Task {
        task_id: id.to_string(),
    }
}

/// The viewer sees every task but the hidden one.
fn viewer_access() -> FakeAccess {
    [BRIEF, REVIEW, TRASHED]
        .into_iter()
        .fold(FakeAccess::default(), |access, task| {
            access.grant(VIEWER, task, AccessLevel::View)
        })
}

fn project_receipt(viewer: &str, entity_type: EntityType) -> TimeScope {
    TimeScope::Project(
        EntityAccessReceipt::try_new_authenticated_user(
            user(viewer),
            Entity {
                entity_id: PROJECT.to_string(),
                entity_type,
            },
            EntityPermission::AccessLevel {
                access_level: AccessLevel::View,
            },
        )
        .unwrap(),
    )
}

fn project_tasks() -> FakeProjects {
    FakeProjects([BRIEF, REVIEW, HIDDEN, TRASHED].map(str::to_owned).to_vec())
}

type PgService = TimeReportServiceImpl<PgTimeReportRepository, FakeAccess, FakeProjects>;

fn service(pool: PgPool, access: FakeAccess, projects: FakeProjects) -> PgService {
    TimeReportServiceImpl::new(
        PgTimeReportRepository::new(pool.clone(), pool),
        Arc::new(access),
        projects,
    )
}

fn minutes_by_key(totals: &[(TimeGroupKey, u32)], key: &TimeGroupKey) -> Option<u32> {
    totals
        .iter()
        .find(|(found, _)| found == key)
        .map(|(_, minutes)| *minutes)
}

fn group_minutes(summary: &TimeSummary) -> Vec<(TimeGroupKey, u32)> {
    summary
        .groups
        .iter()
        .map(|group| (group.key.clone(), group.minutes))
        .collect()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_reports"))
)]
async fn team_time_leaves_out_tasks_the_viewer_cannot_see(pool: PgPool) -> anyhow::Result<()> {
    let access = viewer_access();
    let reports = service(pool, access.clone(), FakeProjects::default());

    let summary = reports
        .summary(&user(VIEWER), TimeScope::Team, november(), by_person())
        .await?;

    // The editor's 90 minutes on the hidden task are in neither their row
    // nor the total; the outsider and former member are not on the team.
    let groups = group_minutes(&summary);
    assert_eq!(minutes_by_key(&groups, &person(EDITOR)), Some(165));
    assert_eq!(minutes_by_key(&groups, &person(AUTHOR)), Some(90));
    assert_eq!(minutes_by_key(&groups, &person(VIEWER)), Some(15));
    assert_eq!(minutes_by_key(&groups, &person(QUIET)), Some(0));
    assert_eq!(minutes_by_key(&groups, &person(OUTSIDER)), None);
    assert_eq!(minutes_by_key(&groups, &person(FORMER)), None);
    assert_eq!(summary.total_minutes, 270);
    assert_eq!(summary.task_count, 2);
    assert_eq!(summary.scope_task_count, None);
    assert!(summary.complete);
    let editor = summary
        .groups
        .iter()
        .find(|group| group.key == person(EDITOR))
        .unwrap();
    assert!(editor.rows.iter().all(|row| row.key != task(HIDDEN)));

    // One access check, for every task the team logged time on.
    assert_eq!(
        access.bulk_checks(),
        [vec![
            BRIEF.to_string(),
            REVIEW.to_string(),
            HIDDEN.to_string(),
            TRASHED.to_string(),
        ]]
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_reports"))
)]
async fn my_time_is_only_mine(pool: PgPool) -> anyhow::Result<()> {
    let reports = service(pool, viewer_access(), FakeProjects::default());

    let summary = reports
        .summary(
            &user(VIEWER),
            TimeScope::Mine,
            november(),
            TimeBreakdown::new(TimeGrouping::Task, Some(TimeGrouping::Day))?,
        )
        .await?;

    assert_eq!(summary.total_minutes, 15);
    assert_eq!(group_minutes(&summary), [(task(REVIEW), 15)]);
    assert_eq!(summary.groups[0].rows.len(), 1);
    assert_eq!(summary.then_totals.len(), 1);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_reports"))
)]
async fn a_projects_time_counts_everyone_on_its_visible_live_tasks(
    pool: PgPool,
) -> anyhow::Result<()> {
    let access = viewer_access();
    let reports = service(pool, access.clone(), project_tasks());

    let summary = reports
        .summary(
            &user(VIEWER),
            project_receipt(VIEWER, EntityType::Initiative),
            november(),
            by_person(),
        )
        .await?;

    // People who left the team or never joined it count; the hidden and the
    // trashed task do not.
    let groups = group_minutes(&summary);
    assert_eq!(minutes_by_key(&groups, &person(OUTSIDER)), Some(10));
    assert_eq!(minutes_by_key(&groups, &person(FORMER)), Some(20));
    assert_eq!(minutes_by_key(&groups, &person(EDITOR)), Some(165));
    assert_eq!(minutes_by_key(&groups, &person(QUIET)), None);
    assert_eq!(summary.total_minutes, 300);
    assert_eq!(summary.task_count, 2);
    assert_eq!(summary.scope_task_count, Some(2));
    assert_eq!(summary.groups[0].key, person(EDITOR));
    assert_eq!(access.bulk_checks().len(), 1);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_reports"))
)]
async fn a_project_report_needs_the_callers_own_project_receipt(
    pool: PgPool,
) -> anyhow::Result<()> {
    let reports = service(pool, viewer_access(), project_tasks());

    for scope in [
        project_receipt(EDITOR, EntityType::Initiative),
        project_receipt(VIEWER, EntityType::Document),
    ] {
        let refused = reports
            .summary(&user(VIEWER), scope, november(), by_person())
            .await;
        assert!(matches!(
            refused,
            Err(TimeTrackingError::NotFound("project"))
        ));
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_project_past_the_task_cap_is_read_to_the_cap_and_marked_incomplete(
    pool: PgPool,
) -> anyhow::Result<()> {
    let ids: Vec<String> = (0..=u32::from(MAX_SCOPE_TASKS))
        .map(|index| format!("task-{index:05}"))
        .collect();
    let access = FakeAccess::default();
    let reports = service(pool, access.clone(), FakeProjects(ids.clone()));

    let summary = reports
        .summary(
            &user(VIEWER),
            project_receipt(VIEWER, EntityType::Initiative),
            november(),
            by_person(),
        )
        .await?;

    assert!(!summary.complete);
    let checks = access.bulk_checks();
    assert_eq!(checks.len(), 1);
    assert_eq!(checks[0].len(), usize::from(MAX_SCOPE_TASKS));
    assert_eq!(checks[0], ids[..usize::from(MAX_SCOPE_TASKS)]);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_reports"))
)]
async fn time_on_more_tasks_than_the_cap_is_read_to_the_cap_and_marked_incomplete(
    pool: PgPool,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        WITH tasks AS (
            SELECT 'cap-' || lpad(g::text, 5, '0') AS id FROM generate_series(0, $1::int) g
        ), documents AS (
            INSERT INTO "Document" (id, name, "fileType", owner)
            SELECT id, 'Capped', 'md', 'macro|viewer@example.com' FROM tasks
        ), sub_types AS (
            INSERT INTO document_sub_type (document_id, sub_type) SELECT id, 'task' FROM tasks
        )
        INSERT INTO time_entry (id, task_id, user_id, entry_date, minutes, source)
        SELECT gen_random_uuid(), id, 'macro|viewer@example.com', '2026-11-10', 5, 'manual'
        FROM tasks
        "#,
        i32::from(MAX_SCOPE_TASKS),
    )
    .execute(&pool)
    .await?;
    let access = FakeAccess::default();
    let reports = service(pool, access.clone(), FakeProjects::default());

    let summary = reports
        .summary(
            &user(VIEWER),
            TimeScope::Mine,
            november(),
            TimeBreakdown::new(TimeGrouping::Day, None)?,
        )
        .await?;

    assert!(!summary.complete);
    assert_eq!(access.bulk_checks()[0].len(), usize::from(MAX_SCOPE_TASKS));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_reports"))
)]
async fn an_export_lists_the_visible_entries_of_the_scope(pool: PgPool) -> anyhow::Result<()> {
    let reports = service(pool, viewer_access(), project_tasks());

    let export = reports
        .export(
            &user(VIEWER),
            project_receipt(VIEWER, EntityType::Initiative),
            november(),
        )
        .await?;

    assert_eq!(export.rows, 7);
    assert!(export.complete);
    let lines: Vec<&str> = export.csv.lines().collect();
    assert_eq!(lines[0], "Date,Person,Task,Minutes,Hours,Note,Source");
    assert_eq!(
        lines[1],
        "2026-11-02,author@example.com,Write the brief,60,1.00,Outline,typed"
    );
    assert!(export.csv.contains("'=Review the brief"));
    assert!(export.csv.contains("'-edits"));
    assert!(!export.csv.contains("Hidden task"));
    assert!(!export.csv.contains("Old task"));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_scope_with_nothing_visible_reads_no_entries(pool: PgPool) -> anyhow::Result<()> {
    let reports = service(pool, FakeAccess::default(), project_tasks());

    let summary = reports
        .summary(
            &user(VIEWER),
            project_receipt(VIEWER, EntityType::Initiative),
            november(),
            by_person(),
        )
        .await?;

    assert_eq!(summary.total_minutes, 0);
    assert_eq!(summary.scope_task_count, Some(0));
    assert!(summary.groups.is_empty());
    Ok(())
}

/// Records which copy each read asked for; holds no time.
#[derive(Clone, Default)]
struct RecordingReports(Arc<Mutex<Vec<ReportRead>>>);

impl RecordingReports {
    fn reads(&self) -> Vec<ReportRead> {
        self.0.lock().unwrap().clone()
    }

    fn record(&self, read: ReportRead) {
        self.0.lock().unwrap().push(read);
    }
}

impl TimeReportRepository for RecordingReports {
    type Err = Infallible;

    async fn team_members(
        &self,
        user_id: &MacroUserIdStr<'static>,
        read: ReportRead,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Self::Err> {
        self.record(read);
        Ok(vec![user_id.clone()])
    }

    async fn people_task_ids(
        &self,
        _people: &[MacroUserIdStr<'static>],
        _period: TimePeriod,
        _limit: u16,
        read: ReportRead,
    ) -> Result<Vec<String>, Self::Err> {
        self.record(read);
        Ok(vec![BRIEF.to_string()])
    }

    async fn live_tasks(
        &self,
        task_ids: &[String],
        read: ReportRead,
    ) -> Result<Vec<ReportTask>, Self::Err> {
        self.record(read);
        Ok(task_ids
            .iter()
            .map(|id| ReportTask {
                id: id.clone(),
                name: "Task".to_string(),
            })
            .collect())
    }

    async fn summary_sums(
        &self,
        _filter: ReportFilter<'_>,
        _breakdown: TimeBreakdown,
        read: ReportRead,
    ) -> Result<Vec<SummarySum>, Self::Err> {
        self.record(read);
        Ok(Vec::new())
    }

    async fn export_entries(
        &self,
        _filter: ReportFilter<'_>,
        _limit: u16,
        read: ReportRead,
    ) -> Result<Vec<ExportEntry>, Self::Err> {
        self.record(read);
        Ok(Vec::new())
    }
}

#[tokio::test]
async fn summaries_read_the_latest_writes_and_exports_may_lag() {
    let repo = RecordingReports::default();
    let reports = TimeReportServiceImpl::new(
        repo.clone(),
        Arc::new(FakeAccess::default().grant(VIEWER, BRIEF, AccessLevel::View)),
        FakeProjects(vec![BRIEF.to_string()]),
    );

    reports
        .summary(&user(VIEWER), TimeScope::Team, november(), by_person())
        .await
        .unwrap();
    reports
        .summary(
            &user(VIEWER),
            project_receipt(VIEWER, EntityType::Initiative),
            november(),
            by_person(),
        )
        .await
        .unwrap();
    assert!(repo.reads().iter().all(|read| *read == ReportRead::Latest));

    let before = repo.reads().len();
    reports
        .export(&user(VIEWER), TimeScope::Team, november())
        .await
        .unwrap();
    assert!(
        repo.reads()[before..]
            .iter()
            .all(|read| *read == ReportRead::MayLag)
    );
}
