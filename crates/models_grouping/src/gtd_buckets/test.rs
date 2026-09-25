use super::*;
use chrono::TimeZone;

fn utc(y: i32, m: u32, d: u32, h: u32, min: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(y, m, d, h, min, 0).unwrap()
}

#[test]
fn ranks_ascend_by_urgency_and_unknown_keys_sort_last() {
    assert_eq!(gtd_bucket_rank(gtd_keys::TODAY), 0);
    assert_eq!(gtd_bucket_rank(gtd_keys::UPCOMING), 1);
    assert_eq!(gtd_bucket_rank(gtd_keys::LATER), 2);
    assert_eq!(gtd_bucket_rank(gtd_keys::BACKLOG), 3);
    assert_eq!(gtd_bucket_rank("something-else"), 3);
}

#[test]
fn rank_round_trips_through_key() {
    for key in [
        gtd_keys::TODAY,
        gtd_keys::UPCOMING,
        gtd_keys::LATER,
        gtd_keys::BACKLOG,
    ] {
        assert_eq!(gtd_bucket_for_rank(gtd_bucket_rank(key)), key);
    }
}

#[test]
fn labels_cover_every_key() {
    assert_eq!(gtd_bucket_label(gtd_keys::TODAY), "Today");
    assert_eq!(gtd_bucket_label(gtd_keys::UPCOMING), "Upcoming");
    assert_eq!(gtd_bucket_label(gtd_keys::LATER), "Later");
    assert_eq!(gtd_bucket_label(gtd_keys::BACKLOG), "Backlog");
    assert_eq!(gtd_bucket_label("unknown"), "Backlog");
}

#[test]
fn utc_boundaries_are_next_midnight_and_horizon() {
    let b = gtd_boundaries(utc(2026, 8, 12, 15, 0), chrono_tz::UTC, 7);

    assert_eq!(b.today_end, utc(2026, 8, 13, 0, 0));
    assert_eq!(b.horizon_end, utc(2026, 8, 20, 0, 0));
}

/// The reason boundaries are computed in Rust rather than from `CURRENT_DATE`:
/// late evening in the Americas is already tomorrow in UTC, so the server's
/// notion of "today" runs a day ahead of the viewer's and swallows work that is
/// genuinely tomorrow's.
#[test]
fn boundaries_follow_the_viewer_not_the_server() {
    // 2026-08-13T02:00Z == 2026-08-12T22:00 EDT: still the 12th in New York,
    // already the 13th in UTC.
    let now = utc(2026, 8, 13, 2, 0);
    let ny = gtd_boundaries(now, chrono_tz::America::New_York, 7);
    let utc_zone = gtd_boundaries(now, chrono_tz::UTC, 7);

    // The viewer's today ends at midnight EDT, four hours from now.
    assert_eq!(ny.today_end, utc(2026, 8, 13, 4, 0));
    // The server's today has 22 hours left to run — a day out of step.
    assert_eq!(utc_zone.today_end, utc(2026, 8, 14, 0, 0));

    // Due 23:30 tonight EDT: today for the viewer, and both agree.
    let tonight = utc(2026, 8, 13, 3, 30);
    assert_eq!(compute_gtd_bucket(Some(tonight), &ny), gtd_keys::TODAY);
    assert_eq!(
        compute_gtd_bucket(Some(tonight), &utc_zone),
        gtd_keys::TODAY
    );

    // Due 08:00 EDT tomorrow morning: Upcoming for the viewer, but a
    // UTC-derived boundary files it under Today. This is the bug.
    let tomorrow_morning = utc(2026, 8, 13, 12, 0);
    assert_eq!(
        compute_gtd_bucket(Some(tomorrow_morning), &ny),
        gtd_keys::UPCOMING
    );
    assert_eq!(
        compute_gtd_bucket(Some(tomorrow_morning), &utc_zone),
        gtd_keys::TODAY
    );
}

#[test]
fn buckets_split_at_the_boundaries() {
    let b = gtd_boundaries(utc(2026, 8, 12, 15, 0), chrono_tz::UTC, 7);

    assert_eq!(compute_gtd_bucket(None, &b), gtd_keys::BACKLOG);
    // Overdue folds into Today rather than getting its own section.
    assert_eq!(
        compute_gtd_bucket(Some(utc(2026, 7, 1, 9, 0)), &b),
        gtd_keys::TODAY
    );
    assert_eq!(
        compute_gtd_bucket(Some(utc(2026, 8, 12, 23, 59)), &b),
        gtd_keys::TODAY
    );
    // Exactly midnight belongs to the next day.
    assert_eq!(
        compute_gtd_bucket(Some(b.today_end), &b),
        gtd_keys::UPCOMING
    );
    assert_eq!(
        compute_gtd_bucket(Some(utc(2026, 8, 19, 23, 59)), &b),
        gtd_keys::UPCOMING
    );
    assert_eq!(compute_gtd_bucket(Some(b.horizon_end), &b), gtd_keys::LATER);
}

#[test]
fn a_zero_day_horizon_leaves_no_upcoming_bucket() {
    let b = gtd_boundaries(utc(2026, 8, 12, 15, 0), chrono_tz::UTC, 0);

    assert_eq!(b.today_end, b.horizon_end);
    assert_eq!(
        compute_gtd_bucket(Some(utc(2026, 8, 13, 0, 1)), &b),
        gtd_keys::LATER
    );
}

/// The whole textual-comparison premise in one test: for RFC 3339 values as
/// `PropertyValue::Date` serializes them, comparing the raw string against a
/// `Z`-less boundary prefix must agree with comparing the parsed instants.
///
/// This is what licenses `values->>'value' < '<prefix>'` in SQL, so if the
/// serialization format ever changes this test is where it surfaces.
#[test]
fn text_comparison_agrees_with_instant_comparison() {
    let b = gtd_boundaries(utc(2026, 8, 12, 15, 0), chrono_tz::UTC, 7);
    let today_end_prefix = boundary_prefix(b.today_end);

    // Includes the cases that motivate dropping the trailing `Z`: values at the
    // boundary second, with and without fractional digits.
    let values = [
        "2026-08-12T00:00:00Z",
        "2026-08-12T23:59:59Z",
        "2026-08-12T23:59:59.999Z",
        "2026-08-13T00:00:00Z",
        "2026-08-13T00:00:00.000Z",
        "2026-08-13T00:00:00.001Z",
        "2026-08-13T00:00:01Z",
        "2026-12-31T12:00:00.5Z",
        "2025-01-01T00:00:00Z",
    ];

    for raw in values {
        let parsed = DateTime::parse_from_rfc3339(raw)
            .unwrap_or_else(|e| panic!("{raw} is not RFC 3339: {e}"))
            .with_timezone(&Utc);

        assert_eq!(
            raw < today_end_prefix.as_str(),
            parsed < b.today_end,
            "text and instant comparison disagree for {raw} against {today_end_prefix}"
        );
    }
}

/// A trailing `Z` on the boundary would invert the comparison for a value that
/// carries fractional seconds — the bug the prefix format exists to avoid.
#[test]
fn a_z_suffixed_boundary_would_misbucket_fractional_values() {
    let b = gtd_boundaries(utc(2026, 8, 12, 15, 0), chrono_tz::UTC, 7);
    let correct = boundary_prefix(b.today_end);
    let naive = format!("{correct}Z");
    let midnight_with_fraction = "2026-08-13T00:00:00.000Z";

    assert!(!(midnight_with_fraction < correct.as_str()));
    assert!(midnight_with_fraction < naive.as_str());
}

#[test]
fn boundary_prefix_emits_only_sql_safe_characters() {
    let prefix = boundary_prefix(utc(2026, 8, 13, 0, 0));

    assert_eq!(prefix, "2026-08-13T00:00:00");
    assert!(
        prefix
            .chars()
            .all(|c| c.is_ascii_digit() || matches!(c, '-' | ':' | 'T')),
        "{prefix} would not be safe to interpolate"
    );
}

/// Cuba shifts its clock at midnight, so 00:00 does not exist on the day DST
/// starts. Bucketing must still produce an instant on that local day rather
/// than panicking or silently falling back to UTC.
#[test]
fn a_skipped_local_midnight_resolves_to_the_first_real_instant() {
    let havana = chrono_tz::America::Havana;
    // Second Sunday in March, when Cuba springs forward at midnight.
    let dst_start = NaiveDate::from_ymd_opt(2026, 3, 8).unwrap();

    let resolved = local_midnight_utc(havana, dst_start);

    assert_eq!(
        resolved.with_timezone(&havana).date_naive(),
        dst_start,
        "resolved instant should still fall on the requested local day"
    );
}

#[test]
fn sql_key_embeds_both_boundaries_and_handles_null() {
    let b = gtd_boundaries(utc(2026, 8, 12, 15, 0), chrono_tz::UTC, 7);
    let sql = gtd_bucket_sql_key("ep_due.due_text", &b);

    assert!(sql.contains("ep_due.due_text IS NULL THEN 'backlog'"));
    assert!(sql.contains("'2026-08-13T00:00:00'"));
    assert!(sql.contains("'2026-08-20T00:00:00'"));
    assert!(sql.contains("ELSE 'later'"));
    assert!(!sql.contains("00:00:00Z"), "boundary must not carry a Z");
}

#[test]
fn sql_order_matches_the_rust_ranks() {
    let b = gtd_boundaries(utc(2026, 8, 12, 15, 0), chrono_tz::UTC, 7);
    let sql = gtd_bucket_sql_order("ep_due.due_text", &b);

    assert!(sql.contains("IS NULL THEN 3"));
    assert!(sql.contains("< '2026-08-13T00:00:00' THEN 0"));
    assert!(sql.contains("< '2026-08-20T00:00:00' THEN 1"));
    assert!(sql.contains("ELSE 2"));

    assert_eq!(gtd_bucket_order(gtd_keys::BACKLOG), 3);
    assert_eq!(gtd_bucket_order(gtd_keys::TODAY), 0);
    assert_eq!(gtd_bucket_order(gtd_keys::UPCOMING), 1);
    assert_eq!(gtd_bucket_order(gtd_keys::LATER), 2);
}
