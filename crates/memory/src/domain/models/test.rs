use super::*;

#[test]
fn calendar_periods_cross_year_and_leap_month() {
    let date = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
    assert_eq!(
        period_start(date, Granularity::Week),
        NaiveDate::from_ymd_opt(2025, 12, 29).unwrap()
    );
    assert_eq!(period_start(date, Granularity::Month), date);
    assert_eq!(
        period_start(
            NaiveDate::from_ymd_opt(2024, 2, 29).unwrap(),
            Granularity::Month
        ),
        NaiveDate::from_ymd_opt(2024, 2, 1).unwrap()
    );
}

#[test]
fn line_edits_preserve_unrelated_lines_and_reject_bad_indices() {
    assert_eq!(
        MemoryEdit::Insert {
            line: 1,
            content: "Use Rust".into()
        }
        .apply("")
        .unwrap(),
        "Use Rust"
    );
    assert_eq!(
        MemoryEdit::Insert {
            line: 2,
            content: "Use Rust".into()
        }
        .apply("Be concise")
        .unwrap(),
        "Be concise\nUse Rust"
    );
    assert_eq!(
        MemoryEdit::Replace {
            line: 2,
            content: "Use TypeScript".into()
        }
        .apply("Be concise\nUse Rust")
        .unwrap(),
        "Be concise\nUse TypeScript"
    );
    assert_eq!(
        MemoryEdit::Delete { line: 1 }
            .apply("Be concise\nUse Rust")
            .unwrap(),
        "Use Rust"
    );
    for edit in [
        MemoryEdit::Delete { line: 0 },
        MemoryEdit::Delete { line: 3 },
        MemoryEdit::Insert {
            line: 4,
            content: "x".into(),
        },
    ] {
        assert!(matches!(edit.apply("a\nb"), Err(MemoryError::InvalidLine)));
    }
    assert!(matches!(
        MemoryEdit::Replace {
            line: 1,
            content: "a\nb".into()
        }
        .apply("a"),
        Err(MemoryError::InvalidContent)
    ));
}

#[test]
fn month_uses_full_weeks_and_uncovered_days_once() {
    let date = NaiveDate::from_ymd_opt(2026, 7, 15).unwrap();
    let rows = vec![
        Activity {
            granularity: Granularity::Week,
            period_start: NaiveDate::from_ymd_opt(2026, 6, 29).unwrap(),
            period_end: NaiveDate::from_ymd_opt(2026, 7, 5).unwrap(),
            content: "crosses month".into(),
        },
        Activity {
            granularity: Granularity::Week,
            period_start: NaiveDate::from_ymd_opt(2026, 7, 6).unwrap(),
            period_end: NaiveDate::from_ymd_opt(2026, 7, 12).unwrap(),
            content: "whole week".into(),
        },
        Activity {
            granularity: Granularity::Week,
            period_start: NaiveDate::from_ymd_opt(2026, 7, 13).unwrap(),
            period_end: date,
            content: "partial week".into(),
        },
        Activity {
            granularity: Granularity::Day,
            period_start: NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
            period_end: NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
            content: "first day".into(),
        },
        Activity {
            granularity: Granularity::Day,
            period_start: NaiveDate::from_ymd_opt(2026, 7, 8).unwrap(),
            period_end: NaiveDate::from_ymd_opt(2026, 7, 8).unwrap(),
            content: "already in whole week".into(),
        },
        Activity {
            granularity: Granularity::Day,
            period_start: date,
            period_end: date,
            content: "last day".into(),
        },
    ];
    let selected: Vec<_> = monthly_sources(&rows, date)
        .into_iter()
        .map(|r| r.content)
        .collect();
    assert_eq!(selected, ["first day", "whole week", "last day"]);
}
