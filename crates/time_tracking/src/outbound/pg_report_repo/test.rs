use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;

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

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

fn day(date: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 11, date).unwrap()
}

fn november() -> TimePeriod {
    TimePeriod::new(day(1), day(30)).unwrap()
}

fn repo(pool: PgPool) -> PgTimeReportRepository {
    PgTimeReportRepository::new(pool.clone(), pool)
}

fn tasks(ids: &[&str]) -> Vec<String> {
    ids.iter().map(|id| id.to_string()).collect()
}

fn person(id: &str) -> TimeGroupKey {
    TimeGroupKey::Person { user_id: user(id) }
}

fn task(id: &str) -> TimeGroupKey {
    TimeGroupKey::Task {
        task_id: id.to_string(),
    }
}

fn sorted(mut sums: Vec<SummarySum>) -> Vec<SummarySum> {
    sums.sort_by_key(|sum| format!("{sum:?}"));
    sums
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_reports"))
)]
async fn team_members_are_the_callers_team_and_the_caller(pool: PgPool) -> anyhow::Result<()> {
    let repo = repo(pool);

    let members = repo.team_members(&user(VIEWER), ReportRead::Latest).await?;
    assert_eq!(
        members,
        [user(AUTHOR), user(EDITOR), user(QUIET), user(VIEWER)]
    );
    let alone = repo.team_members(&user(FORMER), ReportRead::Latest).await?;
    assert_eq!(alone, [user(FORMER)]);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_reports"))
)]
async fn people_tasks_are_the_tasks_they_logged_on_in_the_period(
    pool: PgPool,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    let people = [user(AUTHOR), user(VIEWER)];

    let found = repo
        .people_task_ids(&people, november(), 10, ReportRead::Latest)
        .await?;
    assert_eq!(found, tasks(&[BRIEF, REVIEW, TRASHED]));

    let first = repo
        .people_task_ids(&people, november(), 2, ReportRead::Latest)
        .await?;
    assert_eq!(first, tasks(&[BRIEF, REVIEW]));

    let october = TimePeriod::new(
        NaiveDate::from_ymd_opt(2026, 10, 1).unwrap(),
        NaiveDate::from_ymd_opt(2026, 10, 31).unwrap(),
    )?;
    let earlier = repo
        .people_task_ids(&people, october, 10, ReportRead::Latest)
        .await?;
    assert_eq!(earlier, tasks(&[BRIEF]));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_reports"))
)]
async fn live_task_count_leaves_out_the_trash(pool: PgPool) -> anyhow::Result<()> {
    let count = repo(pool)
        .live_task_count(
            &tasks(&[BRIEF, REVIEW, TRASHED, "missing"]),
            ReportRead::Latest,
        )
        .await?;
    assert_eq!(count, 2);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_reports"))
)]
async fn summary_sums_everyone_on_the_tasks_by_person_then_task(
    pool: PgPool,
) -> anyhow::Result<()> {
    let sums = repo(pool)
        .summary_sums(
            ReportFilter {
                task_ids: &tasks(&[BRIEF, REVIEW, TRASHED]),
                people: None,
                period: november(),
            },
            TimeBreakdown::new(TimeGrouping::Person, Some(TimeGrouping::Task))?,
            ReportRead::Latest,
        )
        .await?;

    // The trashed task's 300 minutes and October's 999 are left out.
    let expected = vec![
        SummarySum::Total {
            minutes: 300,
            task_count: 2,
        },
        SummarySum::Group {
            key: person(AUTHOR),
            minutes: 90,
            task_count: 1,
        },
        SummarySum::Group {
            key: person(EDITOR),
            minutes: 165,
            task_count: 2,
        },
        SummarySum::Group {
            key: person(VIEWER),
            minutes: 15,
            task_count: 1,
        },
        SummarySum::Group {
            key: person(OUTSIDER),
            minutes: 10,
            task_count: 1,
        },
        SummarySum::Group {
            key: person(FORMER),
            minutes: 20,
            task_count: 1,
        },
        SummarySum::Row {
            group: person(AUTHOR),
            key: task(BRIEF),
            minutes: 90,
        },
        SummarySum::Row {
            group: person(EDITOR),
            key: task(BRIEF),
            minutes: 45,
        },
        SummarySum::Row {
            group: person(EDITOR),
            key: task(REVIEW),
            minutes: 120,
        },
        SummarySum::Row {
            group: person(VIEWER),
            key: task(REVIEW),
            minutes: 15,
        },
        SummarySum::Row {
            group: person(OUTSIDER),
            key: task(BRIEF),
            minutes: 10,
        },
        SummarySum::Row {
            group: person(FORMER),
            key: task(REVIEW),
            minutes: 20,
        },
        SummarySum::ThenTotal {
            key: task(BRIEF),
            minutes: 145,
        },
        SummarySum::ThenTotal {
            key: task(REVIEW),
            minutes: 155,
        },
    ];
    assert_eq!(sorted(sums), sorted(expected));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_reports"))
)]
async fn summary_of_people_counts_only_their_entries_by_day(pool: PgPool) -> anyhow::Result<()> {
    let sums = repo(pool)
        .summary_sums(
            ReportFilter {
                task_ids: &tasks(&[BRIEF, REVIEW]),
                people: Some(&[user(EDITOR), user(VIEWER)]),
                period: november(),
            },
            TimeBreakdown::new(TimeGrouping::Day, None)?,
            ReportRead::Latest,
        )
        .await?;

    let expected = vec![
        SummarySum::Total {
            minutes: 180,
            task_count: 2,
        },
        SummarySum::Group {
            key: TimeGroupKey::Day { date: day(2) },
            minutes: 45,
            task_count: 1,
        },
        SummarySum::Group {
            key: TimeGroupKey::Day { date: day(3) },
            minutes: 15,
            task_count: 1,
        },
        SummarySum::Group {
            key: TimeGroupKey::Day { date: day(4) },
            minutes: 120,
            task_count: 1,
        },
    ];
    assert_eq!(sorted(sums), sorted(expected));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_reports"))
)]
async fn export_lists_entries_oldest_first_with_task_names(pool: PgPool) -> anyhow::Result<()> {
    let repo = repo(pool);
    let filter = ReportFilter {
        task_ids: &tasks(&[BRIEF, REVIEW, HIDDEN, TRASHED]),
        people: Some(&[user(AUTHOR), user(EDITOR)]),
        period: november(),
    };

    let entries = repo.export_entries(filter, 10, ReportRead::MayLag).await?;
    let listed: Vec<(NaiveDate, &str, &str, u16)> = entries
        .iter()
        .map(|entry| {
            (
                entry.date,
                entry.user_id.as_ref(),
                entry.task_name.as_str(),
                entry.minutes,
            )
        })
        .collect();
    assert_eq!(
        listed,
        [
            (day(2), AUTHOR, "Write the brief", 60),
            (day(2), EDITOR, "Write the brief", 45),
            (day(3), AUTHOR, "Write the brief", 30),
            (day(4), EDITOR, "=Review the brief", 120),
            (day(4), EDITOR, "Hidden task", 90),
        ]
    );
    assert_eq!(entries[0].note.as_deref(), Some("Outline"));
    assert_eq!(entries[2].source, TimeEntrySource::Timer);

    let first_two = repo.export_entries(filter, 2, ReportRead::MayLag).await?;
    assert_eq!(first_two.len(), 2);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn every_read_runs_under_a_statement_timeout(pool: PgPool) -> anyhow::Result<()> {
    let repo = repo(pool);
    for read in [ReportRead::Latest, ReportRead::MayLag] {
        let mut tx = repo.begin(read).await?;
        let timeout =
            sqlx::query_scalar!(r#"SELECT current_setting('statement_timeout') AS "timeout!""#)
                .fetch_one(&mut *tx)
                .await?;
        assert_eq!(timeout, "5s");
    }
    Ok(())
}
