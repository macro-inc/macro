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
fn a_cursor_dead_letters_after_about_six_hours_of_retries() {
    let total: i64 = (1..MAX_ATTEMPTS)
        .map(|attempts| backoff(attempts).num_seconds())
        .sum();
    // Attempts 1–14 wait 19 515 s before jitter and at most a fifth more.
    assert!((19_515..=23_418).contains(&total), "{total} seconds");
}
