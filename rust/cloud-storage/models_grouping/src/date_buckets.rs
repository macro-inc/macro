//! Date bucket logic and SQL helpers.

use chrono::{DateTime, Duration, NaiveTime, Utc};

/// Date bucket keys.
pub mod keys {
    /// Future bucket key (items with future timestamps)
    pub const FUTURE: &str = "future";
    /// Today bucket key
    pub const TODAY: &str = "today";
    /// Yesterday bucket key
    pub const YESTERDAY: &str = "yesterday";
    /// This week bucket key (2-6 days ago)
    pub const THIS_WEEK: &str = "this_week";
    /// Last week bucket key (7-13 days ago)
    pub const LAST_WEEK: &str = "last_week";
    /// This month bucket key (14-30 days ago)
    pub const THIS_MONTH: &str = "this_month";
    /// Last month bucket key (31-60 days ago)
    pub const LAST_MONTH: &str = "last_month";
    /// Older bucket key (61+ days ago)
    pub const OLDER: &str = "older";
}

/// Compute the date bucket key for a timestamp.
pub fn compute_date_bucket(ts: DateTime<Utc>) -> &'static str {
    let days_ago = (Utc::now().date_naive() - ts.date_naive()).num_days();
    match days_ago {
        ..=-1 => keys::FUTURE,
        0 => keys::TODAY,
        1 => keys::YESTERDAY,
        2..=6 => keys::THIS_WEEK,
        7..=13 => keys::LAST_WEEK,
        14..=30 => keys::THIS_MONTH,
        31..=60 => keys::LAST_MONTH,
        _ => keys::OLDER,
    }
}

/// Get display order for a date bucket (lower = first).
pub fn date_bucket_order(key: &str) -> i32 {
    match key {
        keys::FUTURE => -1,
        keys::TODAY => 0,
        keys::YESTERDAY => 1,
        keys::THIS_WEEK => 2,
        keys::LAST_WEEK => 3,
        keys::THIS_MONTH => 4,
        keys::LAST_MONTH => 5,
        _ => 6,
    }
}

/// Get human-readable label for a date bucket.
pub fn date_bucket_label(key: &str) -> &'static str {
    match key {
        keys::FUTURE => "Upcoming",
        keys::TODAY => "Today",
        keys::YESTERDAY => "Yesterday",
        keys::THIS_WEEK => "This Week",
        keys::LAST_WEEK => "Last Week",
        keys::THIS_MONTH => "This Month",
        keys::LAST_MONTH => "Last Month",
        _ => "Older",
    }
}

/// Check if a bucket key is a valid date bucket.
pub fn is_valid_date_bucket_key(key: &str) -> bool {
    matches!(
        key,
        keys::FUTURE
            | keys::TODAY
            | keys::YESTERDAY
            | keys::THIS_WEEK
            | keys::LAST_WEEK
            | keys::THIS_MONTH
            | keys::LAST_MONTH
            | keys::OLDER
    )
}

/// Convert a bucket key to a timestamp range (start_inclusive, end_exclusive).
///
/// Returns `None` for invalid bucket keys.
pub fn date_bucket_to_range(bucket_key: &str) -> Option<(DateTime<Utc>, DateTime<Utc>)> {
    let now = Utc::now();
    let today_start = now.date_naive().and_time(NaiveTime::MIN).and_utc();
    let tomorrow_start = today_start + Duration::days(1);

    let (start, end) = match bucket_key {
        keys::FUTURE => (tomorrow_start, DateTime::<Utc>::MAX_UTC),
        keys::TODAY => (today_start, tomorrow_start),
        keys::YESTERDAY => (today_start - Duration::days(1), today_start),
        keys::THIS_WEEK => {
            let end = today_start - Duration::days(1);
            let start = today_start - Duration::days(6);
            (start, end)
        }
        keys::LAST_WEEK => {
            let end = today_start - Duration::days(6);
            let start = today_start - Duration::days(13);
            (start, end)
        }
        keys::THIS_MONTH => {
            let end = today_start - Duration::days(13);
            let start = today_start - Duration::days(30);
            (start, end)
        }
        keys::LAST_MONTH => {
            let end = today_start - Duration::days(30);
            let start = today_start - Duration::days(60);
            (start, end)
        }
        keys::OLDER => {
            let end = today_start - Duration::days(60);
            let start = today_start - Duration::days(365 * 10);
            (start, end)
        }
        _ => return None,
    };

    Some((start, end))
}

/// SQL CASE expression for date bucket key.
///
/// Returns a SQL fragment that computes the bucket key from a timestamp column.
///
/// # Example
/// ```
/// use models_grouping::date_bucket_sql_key;
/// let sql = date_bucket_sql_key("et.sort_ts");
/// assert!(sql.contains("'today'"));
/// ```
pub fn date_bucket_sql_key(sort_col: &str) -> String {
    format!(
        r#"CASE
    WHEN {sort_col}::date > CURRENT_DATE THEN 'future'
    WHEN {sort_col}::date = CURRENT_DATE THEN 'today'
    WHEN {sort_col}::date = CURRENT_DATE - 1 THEN 'yesterday'
    WHEN {sort_col} >= CURRENT_DATE - 6 THEN 'this_week'
    WHEN {sort_col} >= CURRENT_DATE - 13 THEN 'last_week'
    WHEN {sort_col} >= CURRENT_DATE - 30 THEN 'this_month'
    WHEN {sort_col} >= CURRENT_DATE - 60 THEN 'last_month'
    ELSE 'older'
END"#
    )
}

/// SQL CASE expression for date bucket order.
///
/// Returns a SQL fragment that computes the display order from a timestamp column.
pub fn date_bucket_sql_order(sort_col: &str) -> String {
    format!(
        r#"CASE
    WHEN {sort_col}::date > CURRENT_DATE THEN -1
    WHEN {sort_col}::date = CURRENT_DATE THEN 0
    WHEN {sort_col}::date = CURRENT_DATE - 1 THEN 1
    WHEN {sort_col} >= CURRENT_DATE - 6 THEN 2
    WHEN {sort_col} >= CURRENT_DATE - 13 THEN 3
    WHEN {sort_col} >= CURRENT_DATE - 30 THEN 4
    WHEN {sort_col} >= CURRENT_DATE - 60 THEN 5
    ELSE 6
END"#
    )
}

#[cfg(test)]
mod test {
    use super::*;
    use chrono::Duration;

    #[test]
    fn test_compute_date_bucket_future() {
        let future = Utc::now() + Duration::days(7);
        assert_eq!(compute_date_bucket(future), keys::FUTURE);
    }

    #[test]
    fn test_compute_date_bucket_today() {
        let now = Utc::now();
        assert_eq!(compute_date_bucket(now), keys::TODAY);
    }

    #[test]
    fn test_compute_date_bucket_yesterday() {
        let yesterday = Utc::now() - Duration::days(1);
        assert_eq!(compute_date_bucket(yesterday), keys::YESTERDAY);
    }

    #[test]
    fn test_compute_date_bucket_this_week() {
        let days_ago = Utc::now() - Duration::days(4);
        assert_eq!(compute_date_bucket(days_ago), keys::THIS_WEEK);
    }

    #[test]
    fn test_compute_date_bucket_older() {
        let old = Utc::now() - Duration::days(100);
        assert_eq!(compute_date_bucket(old), keys::OLDER);
    }

    #[test]
    fn test_date_bucket_order() {
        assert_eq!(date_bucket_order(keys::FUTURE), -1);
        assert_eq!(date_bucket_order(keys::TODAY), 0);
        assert_eq!(date_bucket_order(keys::YESTERDAY), 1);
        assert_eq!(date_bucket_order(keys::OLDER), 6);
        assert_eq!(date_bucket_order("unknown"), 6);
    }

    #[test]
    fn test_date_bucket_label() {
        assert_eq!(date_bucket_label(keys::FUTURE), "Upcoming");
        assert_eq!(date_bucket_label(keys::TODAY), "Today");
        assert_eq!(date_bucket_label(keys::OLDER), "Older");
    }

    #[test]
    fn test_date_bucket_sql_key() {
        let sql = date_bucket_sql_key("et.sort_ts");
        assert!(sql.contains("'future'"));
        assert!(sql.contains("'today'"));
        assert!(sql.contains("'yesterday'"));
        assert!(sql.contains("et.sort_ts"));
    }

    #[test]
    fn test_is_valid_date_bucket_key() {
        assert!(is_valid_date_bucket_key(keys::FUTURE));
        assert!(is_valid_date_bucket_key(keys::TODAY));
        assert!(is_valid_date_bucket_key(keys::OLDER));
        assert!(!is_valid_date_bucket_key("invalid"));
        assert!(!is_valid_date_bucket_key(""));
    }

    #[test]
    fn test_date_bucket_to_range_valid() {
        let range = date_bucket_to_range(keys::TODAY);
        assert!(range.is_some());
        let (start, end) = range.unwrap();
        assert!(start < end);
    }

    #[test]
    fn test_date_bucket_to_range_invalid() {
        assert!(date_bucket_to_range("invalid").is_none());
    }
}
