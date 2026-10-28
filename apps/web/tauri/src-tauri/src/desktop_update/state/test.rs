use super::*;

#[test]
fn disabled_and_busy_states_never_start_another_download() {
    assert!(!State::<()>::new(false).begin_check());
    let mut state = State::new(true);
    assert!(state.begin_check());
    assert!(!state.begin_check());
    state.downloaded("2.5.1".into(), ());
    assert!(!state.begin_check());
}

#[test]
fn quit_during_download_does_not_install_partial_bytes() {
    let mut state = State::<()>::new(true);
    state.begin_check();
    state.status = Status::Downloading {
        version: "2.5.1".into(),
    };
    assert!(state.begin_install().is_none());
    assert!(!state.is_installing());
}

#[test]
fn verified_update_can_only_be_installed_once() {
    let mut state = State::new(true);
    state.downloaded("2.5.1".into(), vec![1, 2, 3]);
    assert_eq!(state.begin_install(), Some(vec![1, 2, 3]));
    assert!(state.is_installing());
    assert!(state.begin_install().is_none());
    assert!(!state.begin_check());
    state.finish_exit();
    assert!(!state.is_installing());
    assert!(!state.begin_check());
}

#[test]
fn failed_checks_can_retry() {
    let mut state = State::<()>::new(true);
    state.begin_check();
    state.status = Status::Error {
        message: "offline".into(),
    };
    assert!(state.begin_check());
}
