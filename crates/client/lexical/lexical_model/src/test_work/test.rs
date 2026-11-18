use super::*;

#[test]
fn work_scope_excludes_unrelated_reads_and_restores_after_unwind() {
    let measurement = Measurement::start();
    record_text_visit();
    assert_eq!(measurement.text_visits(), 0);
    {
        let _scope = enter(Phase::ModelCaches);
        record_text_visit();
        {
            let _nested = enter(Phase::ModelCaches);
            record_text_visit();
        }
        record_text_visit();
    }
    record_text_visit();
    assert_eq!(measurement.text_visits(), 3);
    drop(measurement);

    let unwind = std::panic::catch_unwind(|| {
        let _measurement = Measurement::start();
        let _scope = enter(Phase::ModelCaches);
        record_text_visit();
        panic!("test-only unwind");
    });
    assert!(unwind.is_err());
    let measurement = Measurement::start();
    let _scope = enter(Phase::ModelCaches);
    record_text_visit();
    assert_eq!(measurement.text_visits(), 1);
}

#[test]
fn retired_phase_scope_cannot_change_a_later_measurement() {
    let first = Measurement::start();
    let retired_scope = enter(Phase::ModelCaches);
    drop(first);
    let second = Measurement::start();
    let current_scope = enter(Phase::ModelCaches);
    drop(retired_scope);
    record_text_visit();
    assert_eq!(second.text_visits(), 1);
    drop(current_scope);
    record_text_visit();
    assert_eq!(second.text_visits(), 1);
}
