use super::*;

/// 2007-10-12 16:28:34, the example ECMA-376 gives for every format.
fn spec_example() -> FieldTime {
    FieldTime {
        year: 2007,
        month: 10,
        day: 12,
        hour: 16,
        minute: 28,
        second: 34,
    }
}

#[test]
fn formats_every_powerpoint_date_style() {
    let t = spec_example();
    let expected = [
        "10/12/2007",
        "Friday, October 12, 2007",
        "12 October 2007",
        "October 12, 2007",
        "12-Oct-07",
        "October 07",
        "Oct-07",
        "10/12/2007 4:28 PM",
        "10/12/2007 4:28:34 PM",
        "16:28",
        "16:28:34",
        "4:28 PM",
        "4:28:34 PM",
    ];
    for (kind, text) in DATE_FORMATS.iter().zip(expected) {
        assert_eq!(t.format(kind).as_deref(), Some(text), "{kind}");
    }
    assert_eq!(t.format("datetime").as_deref(), Some("10/12/2007"));
    assert_eq!(t.format("slidenum"), None);
    assert_eq!(t.format("datetimeFigureOut"), None);
}

#[test]
fn twelve_hour_clock_edges() {
    let at = |hour| FieldTime {
        hour,
        minute: 5,
        ..spec_example()
    };
    assert_eq!(at(0).format("datetime12").as_deref(), Some("12:05 AM"));
    assert_eq!(at(12).format("datetime12").as_deref(), Some("12:05 PM"));
    assert_eq!(at(23).format("datetime12").as_deref(), Some("11:05 PM"));
}

#[test]
fn unix_times_map_to_calendar_dates() {
    assert_eq!(
        FieldTime::from_unix(0, 0),
        FieldTime {
            year: 1970,
            month: 1,
            day: 1,
            hour: 0,
            minute: 0,
            second: 0,
        }
    );
    // 2024-02-29 23:30:00 UTC, a leap day; two hours east it is March 1st.
    let leap = 1_709_249_400;
    let utc = FieldTime::from_unix(leap, 0);
    assert_eq!((utc.year, utc.month, utc.day, utc.hour), (2024, 2, 29, 23));
    assert_eq!(
        utc.format("datetime2").as_deref(),
        Some("Thursday, February 29, 2024")
    );
    let east = FieldTime::from_unix(leap, 120);
    assert_eq!((east.month, east.day, east.hour), (3, 1, 1));
    // Before the epoch.
    let before = FieldTime::from_unix(-1, 0);
    assert_eq!((before.year, before.month, before.day), (1969, 12, 31));
    assert_eq!((before.hour, before.minute, before.second), (23, 59, 59));
}
