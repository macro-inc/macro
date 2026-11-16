use super::*;

#[test]
fn delay_doubles_per_refusal_up_to_the_cap() {
    let mut backoff = CredentialBackoff::default();
    let start = Instant::now();
    let hash = [7; 32];
    assert!(!backoff.waiting(&hash, start));

    assert_eq!(backoff.refused(hash, start), Some(1));
    assert!(backoff.waiting(&hash, start + Duration::from_millis(999)));
    assert!(!backoff.waiting(&hash, start + Duration::from_secs(1)));

    let second = start + Duration::from_secs(1);
    assert_eq!(backoff.refused(hash, second), Some(2));
    assert!(backoff.waiting(&hash, second + Duration::from_millis(1999)));
    assert!(!backoff.waiting(&hash, second + Duration::from_secs(2)));

    let mut now = second;
    for _ in 0..20 {
        backoff.refused(hash, now);
    }
    now += Duration::from_secs(299);
    assert!(backoff.waiting(&hash, now));
    assert!(!backoff.waiting(&hash, now + Duration::from_secs(1)));
    assert!(!backoff.waiting(&[8; 32], now));
}

#[test]
fn a_full_table_forgets_quiet_credentials_but_keeps_live_ones() {
    let mut backoff = CredentialBackoff::default();
    let start = Instant::now();
    for index in 0..CAPACITY {
        let mut hash = [0; 32];
        hash[..8].copy_from_slice(&(index as u64).to_le_bytes());
        backoff.refused(hash, start);
    }

    let newcomer = [0xff; 32];
    assert_eq!(backoff.refused(newcomer, start), None);
    assert!(!backoff.waiting(&newcomer, start));

    let later = start + FIRST_DELAY + MAX_DELAY;
    assert_eq!(backoff.refused(newcomer, later), Some(1));
    assert!(backoff.waiting(&newcomer, later));
    assert_eq!(backoff.0.len(), 1);
}
