use std::time::Duration;

use tokio::time::Instant;

use super::*;

const KEEP: Duration = Duration::from_secs(60);

#[test]
fn a_value_is_remembered_for_a_while() {
    let recent = Recent::new(KEEP, 4);
    let start = Instant::now();
    assert_eq!(recent.get("a", start), None);
    recent.put("a", true, start);
    assert_eq!(recent.get("a", start + Duration::from_secs(59)), Some(true));
    assert_eq!(recent.get("a", start + KEEP), None);
    recent.put("a", false, start + KEEP);
    assert_eq!(recent.get("a", start + KEEP), Some(false));
}

#[test]
fn a_full_memo_forgets_stale_keys_first_then_everything() {
    let recent = Recent::new(KEEP, 2);
    let start = Instant::now();
    recent.put("old", 1, start);
    recent.put("new", 2, start + Duration::from_secs(30));
    let later = start + Duration::from_secs(70);
    recent.put("third", 3, later);
    assert_eq!(recent.get("old", later), None);
    assert_eq!(recent.get("new", later), Some(2));
    assert_eq!(recent.get("third", later), Some(3));
    recent.put("fourth", 4, later);
    assert_eq!(recent.get("new", later), None);
    assert_eq!(recent.get("fourth", later), Some(4));
}

#[test]
fn updating_a_key_in_a_full_memo_keeps_the_others() {
    let recent = Recent::new(KEEP, 2);
    let start = Instant::now();
    recent.put("a", 1, start);
    recent.put("b", 2, start);
    recent.put("a", 3, start);
    assert_eq!(recent.get("a", start), Some(3));
    assert_eq!(recent.get("b", start), Some(2));
}
