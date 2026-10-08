#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

// MINUTE and SECOND round the time of day to the nearest millisecond first.
#[test]
fn minute_and_second_round_to_the_millisecond() {
    let mut model = new_empty_model();
    // 12:29:59.99997 -> 12:30:00.000
    model._set("A1", "=MINUTE(0.520833333)");
    model._set("A2", "=SECOND(0.520833333)");
    // 45.999 seconds is kept as is: still 45
    model._set("A3", "=SECOND(TIME(14,30,45.999))");
    // 00:00:00.9996 -> 00:00:01.000
    model._set("A4", "=SECOND(0.9996/86400)");
    // A time that rounds up to midnight
    model._set("A5", "=MINUTE(0.99999999999)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "30");
    assert_eq!(model._get_text("A2"), "0");
    assert_eq!(model._get_text("A3"), "45");
    assert_eq!(model._get_text("A4"), "1");
    assert_eq!(model._get_text("A5"), "0");
}
