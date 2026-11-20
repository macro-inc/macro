use chrono::Timelike;

use super::*;

#[test]
fn the_system_clock_reads_no_finer_than_postgres_stores() {
    let now = SystemClock.now();

    assert_eq!(now.nanosecond() % 1_000, 0);
}
