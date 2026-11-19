use super::*;
#[test]
fn repeated_network_outage_opens_and_only_one_probe_can_recover() {
    let health = Health::default();
    let now = Instant::now();
    for _ in 0..5 {
        health.admit_at("mail.example.net:993", now).unwrap();
        health.report_at("mail.example.net:993", now, false);
    }
    assert_eq!(
        health.admit_at("mail.example.net:993", now).unwrap_err(),
        Error::Throttled
    );
    health.admit_at("mail.example.net:465", now).unwrap();
    let later = now + Duration::from_secs(61);
    health.admit_at("mail.example.net:993", later).unwrap();
    assert_eq!(
        health.admit_at("mail.example.net:993", later).unwrap_err(),
        Error::Throttled
    );
    health.report_at("mail.example.net:993", later, true);
    health.admit_at("mail.example.net:993", later).unwrap();
}
#[test]
fn scattered_failures_do_not_accumulate_forever() {
    let health = Health::default();
    let now = Instant::now();
    for n in 0..20 {
        let at = now + Duration::from_secs(n * 61);
        health.admit_at("mail.example.net:993", at).unwrap();
        health.report_at("mail.example.net:993", at, false);
    }
}
#[test]
fn idle_hosts_expire_without_evicting_an_active_attempt_or_open_circuit() {
    let health = Health::default();
    let now = Instant::now();
    health.admit_at("active.example.net:993", now).unwrap();
    health.admit_at("idle.example.net:993", now).unwrap();
    health.report_at("idle.example.net:993", now, true);
    for _ in 0..5 {
        health.admit_at("open.example.net:993", now).unwrap();
        health.report_at("open.example.net:993", now, false);
    }
    let later = now + Duration::from_secs(3601);
    health.admit_at("new.example.net:993", later).unwrap();
    let states = health.0.lock().unwrap();
    assert!(states.contains_key("active.example.net:993"));
    assert!(!states.contains_key("idle.example.net:993"));
    assert!(!states.contains_key("open.example.net:993"));
}
