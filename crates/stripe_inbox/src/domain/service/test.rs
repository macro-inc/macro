use super::*;

#[test]
fn backoff_doubles_from_five_seconds_and_caps_at_an_hour() {
    for (attempts, base_seconds) in [
        (1, 5),
        (2, 10),
        (3, 20),
        (4, 40),
        (10, 2560),
        (11, 3600),
        (30, 3600),
    ] {
        let delay = backoff(attempts);
        let base = chrono::Duration::seconds(base_seconds);
        assert!(delay >= base, "attempt {attempts}: {delay} < {base}");
        assert!(
            delay <= base + base / 5,
            "attempt {attempts}: {delay} has too much jitter"
        );
    }
}

#[test]
fn a_cursor_retries_through_stripes_three_day_redelivery_window() {
    let total: i64 = (1..MAX_ATTEMPTS)
        .map(|attempts| backoff(attempts).num_seconds())
        .sum();
    // Attempts 1–83 wait 267 915 s (74.4 h) before jitter and at most a
    // fifth more: past the 72 hours Stripe redelivers for.
    assert!(total > 72 * 3600, "{total} seconds");
    assert!((267_915..=321_498).contains(&total), "{total} seconds");
}
