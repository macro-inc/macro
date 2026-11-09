use super::*;
use crate::{
    container::ContainerType,
    event::{DiffVariant, InternalContainerDiff},
};

#[test]
fn local_suspension_preserves_pending_diff_batches() {
    let doc = crate::LoroDoc::new();
    let mut state = doc.app_state().lock();
    state.start_recording();
    state.record_diff(InternalDocDiff {
        origin: "remote".into(),
        by: EventTriggerKind::Import,
        diff: Cow::Owned(vec![InternalContainerDiff {
            idx: ContainerIdx::from_index_and_type(0, ContainerType::Map),
            bring_back: false,
            diff: DiffVariant::None,
            diff_mode: crate::diff_calc::DiffMode::Linear,
            kept: None,
        }]),
        new_version: Cow::Owned(Frontiers::default()),
    });
    let allocation = state.event_recorder.diffs.as_ptr();
    assert!(!state.suspend_recording_for_local_commit());
    assert!(state.is_recording());
    assert_eq!(state.event_recorder.diffs.len(), 1);
    assert_eq!(state.event_recorder.diffs.as_ptr(), allocation);
    assert_eq!(state.event_recorder.diffs[0].origin.as_str(), "remote");
}

#[test]
fn local_suspension_preserves_queued_public_events() {
    let doc = crate::LoroDoc::new();
    let mut state = doc.app_state().lock();
    state.start_recording();
    state.event_recorder.events.push(DocDiff {
        from: Frontiers::default(),
        to: Frontiers::default(),
        origin: "remote".into(),
        by: EventTriggerKind::Import,
        diff: vec![],
    });
    assert!(!state.suspend_recording_for_local_commit());
    assert!(state.is_recording());
    assert_eq!(state.event_recorder.events.len(), 1);
    assert_eq!(state.event_recorder.events[0].origin.as_str(), "remote");
}
