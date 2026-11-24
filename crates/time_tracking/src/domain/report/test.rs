use macro_user_id::cowlike::CowLike;

use super::*;

const ANA: &str = "macro|ana@example.com";
const BEN: &str = "macro|ben@example.com";
const CAL: &str = "macro|cal@example.com";

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

fn day(date: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 11, date).unwrap()
}

fn week() -> TimePeriod {
    TimePeriod::new(day(23), day(29)).unwrap()
}

fn person(id: &str) -> TimeGroupKey {
    TimeGroupKey::Person { user_id: user(id) }
}

fn task(id: &str) -> TimeGroupKey {
    TimeGroupKey::Task {
        task_id: id.to_string(),
    }
}

fn on(date: u32) -> TimeGroupKey {
    TimeGroupKey::Day { date: day(date) }
}

#[test]
fn a_period_runs_forward_for_at_most_366_days() {
    let start = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
    assert!(TimePeriod::new(start, start).is_ok());
    assert!(TimePeriod::new(start, start + chrono::Days::new(365)).is_ok());
    assert!(matches!(
        TimePeriod::new(start, start + chrono::Days::new(366)),
        Err(TimeTrackingError::InvalidInput(_))
    ));
    assert!(matches!(
        TimePeriod::new(day(2), day(1)),
        Err(TimeTrackingError::InvalidInput(_))
    ));
}

#[test]
fn groups_are_split_by_a_different_grouping() {
    assert!(TimeBreakdown::new(TimeGrouping::Task, Some(TimeGrouping::Day)).is_ok());
    assert!(TimeBreakdown::new(TimeGrouping::Task, None).is_ok());
    assert!(matches!(
        TimeBreakdown::new(TimeGrouping::Day, Some(TimeGrouping::Day)),
        Err(TimeTrackingError::InvalidInput(_))
    ));
}

#[test]
fn keys_serialize_with_what_they_are_by() {
    assert_eq!(
        serde_json::to_value(person(ANA)).unwrap(),
        serde_json::json!({ "by": "person", "userId": ANA })
    );
    assert_eq!(
        serde_json::to_value(task("t1")).unwrap(),
        serde_json::json!({ "by": "task", "taskId": "t1" })
    );
    assert_eq!(
        serde_json::to_value(on(23)).unwrap(),
        serde_json::json!({ "by": "day", "date": "2026-11-23" })
    );
}

#[test]
fn a_summary_puts_the_most_time_first_and_days_in_order() {
    let breakdown = TimeBreakdown::new(TimeGrouping::Task, Some(TimeGrouping::Day)).unwrap();
    let sums = vec![
        SummarySum::Total {
            minutes: 300,
            task_count: 3,
        },
        SummarySum::Group {
            key: task("b"),
            minutes: 60,
            task_count: 1,
        },
        SummarySum::Group {
            key: task("c"),
            minutes: 180,
            task_count: 1,
        },
        SummarySum::Group {
            key: task("a"),
            minutes: 60,
            task_count: 1,
        },
        SummarySum::Row {
            group: task("c"),
            key: on(25),
            minutes: 120,
        },
        SummarySum::Row {
            group: task("c"),
            key: on(23),
            minutes: 60,
        },
        SummarySum::Row {
            group: task("a"),
            key: on(24),
            minutes: 60,
        },
        SummarySum::Row {
            group: task("b"),
            key: on(24),
            minutes: 60,
        },
        SummarySum::ThenTotal {
            key: on(25),
            minutes: 120,
        },
        SummarySum::ThenTotal {
            key: on(23),
            minutes: 60,
        },
        SummarySum::ThenTotal {
            key: on(24),
            minutes: 120,
        },
    ];

    let summary = assemble_summary(week(), breakdown, sums, None, Some(5), true);

    assert_eq!(summary.from, day(23));
    assert_eq!(summary.to, day(29));
    assert_eq!(summary.total_minutes, 300);
    assert_eq!(summary.task_count, 3);
    assert_eq!(summary.scope_task_count, Some(5));
    let order: Vec<&TimeGroupKey> = summary.groups.iter().map(|group| &group.key).collect();
    assert_eq!(order, [&task("c"), &task("a"), &task("b")]);
    let c_days: Vec<&TimeGroupKey> = summary.groups[0].rows.iter().map(|row| &row.key).collect();
    assert_eq!(c_days, [&on(23), &on(25)]);
    let columns: Vec<(&TimeGroupKey, u32)> = summary
        .then_totals
        .iter()
        .map(|total| (&total.key, total.minutes))
        .collect();
    assert_eq!(columns, [(&on(23), 60), (&on(24), 120), (&on(25), 120)]);
}

#[test]
fn every_member_gets_a_person_group_with_or_without_time() {
    let members = [user(ANA), user(BEN), user(CAL)];
    let by_person = TimeBreakdown::new(TimeGrouping::Person, Some(TimeGrouping::Day)).unwrap();
    let sums = vec![
        SummarySum::Total {
            minutes: 90,
            task_count: 1,
        },
        SummarySum::Group {
            key: person(BEN),
            minutes: 90,
            task_count: 1,
        },
        SummarySum::Row {
            group: person(BEN),
            key: on(24),
            minutes: 90,
        },
    ];

    let summary = assemble_summary(week(), by_person, sums, Some(&members), None, true);

    let groups: Vec<(&TimeGroupKey, u32, usize)> = summary
        .groups
        .iter()
        .map(|group| (&group.key, group.minutes, group.rows.len()))
        .collect();
    assert_eq!(
        groups,
        [(&person(BEN), 90, 1), (&person(ANA), 0, 0), (&person(CAL), 0, 0)]
    );

    let by_day = TimeBreakdown::new(TimeGrouping::Day, Some(TimeGrouping::Person)).unwrap();
    let summary = assemble_summary(week(), by_day, Vec::new(), Some(&members), None, true);
    assert!(summary.groups.is_empty());
    assert_eq!(summary.then_totals.len(), 3);
    assert!(summary.then_totals.iter().all(|total| total.minutes == 0));
}

#[test]
fn a_summary_without_a_second_grouping_has_no_rows() {
    let breakdown = TimeBreakdown::new(TimeGrouping::Person, None).unwrap();
    let sums = vec![SummarySum::Group {
        key: person(ANA),
        minutes: 30,
        task_count: 1,
    }];
    let summary = assemble_summary(week(), breakdown, sums, None, None, false);
    assert!(summary.groups[0].rows.is_empty());
    assert!(summary.then_totals.is_empty());
    assert!(!summary.complete);
}

fn entry(note: Option<&str>, minutes: u16) -> ExportEntry {
    ExportEntry {
        date: day(23),
        user_id: user(ANA),
        task_name: "Design review".to_string(),
        minutes,
        note: note.map(str::to_owned),
        source: TimeEntrySource::Manual,
    }
}

#[test]
fn an_export_writes_one_row_per_entry_with_hours() {
    let export = encode_export(
        &[entry(Some("Kickoff, with notes"), 90), entry(None, 20)],
        true,
    )
    .unwrap();
    assert_eq!(
        export.csv,
        "Date,Person,Task,Minutes,Hours,Note,Source\n\
         2026-11-23,ana@example.com,Design review,90,1.50,\"Kickoff, with notes\",typed\n\
         2026-11-23,ana@example.com,Design review,20,0.33,,typed\n"
    );
    assert_eq!(export.rows, 2);
    assert!(export.complete);
}

#[test]
fn an_export_never_writes_a_cell_a_spreadsheet_would_run() {
    let mut risky = entry(Some("=HYPERLINK(\"http://example.com\")"), 30);
    risky.task_name = "@SUM(A1)".to_string();
    let export = encode_export(&[risky, entry(Some("-5 for travel"), 15)], true).unwrap();
    let lines: Vec<&str> = export.csv.lines().collect();
    assert!(lines[1].contains("'@SUM(A1)"));
    assert!(lines[1].contains("'=HYPERLINK"));
    assert!(lines[2].contains("'-5 for travel"));
}

#[test]
fn an_export_stops_at_ten_thousand_entries() {
    let entries = vec![entry(None, 15); usize::from(MAX_EXPORT_ROWS) + 1];
    let export = encode_export(&entries, true).unwrap();
    assert_eq!(export.rows, u32::from(MAX_EXPORT_ROWS));
    assert!(!export.complete);

    let exactly = encode_export(&entries[..usize::from(MAX_EXPORT_ROWS)], true).unwrap();
    assert!(exactly.complete);
}

#[test]
fn an_export_stops_before_sixteen_mebibytes() {
    let note = "n".repeat(2_000);
    let entries = vec![entry(Some(&note), 15); usize::from(MAX_EXPORT_ROWS)];
    let export = encode_export(&entries, true).unwrap();
    assert!(export.csv.len() <= MAX_EXPORT_BYTES);
    assert!(export.rows < u32::from(MAX_EXPORT_ROWS));
    assert!(!export.complete);
}

#[test]
fn an_export_of_an_incomplete_scope_says_so() {
    let export = encode_export(&[entry(None, 15)], false).unwrap();
    assert!(!export.complete);
}
