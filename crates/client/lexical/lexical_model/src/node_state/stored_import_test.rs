use super::*;
use crate::RequiredState;
use serde_json::json;

static NEVER_PARSE: StateKey<u32> = StateKey::new("flat", |_| {
    panic!("storage provenance must not invoke a parser or default")
});

#[test]
fn raw_only_allocation_and_flat_precedence_do_not_invoke_state_callbacks() {
    let layout = StateLayout {
        entries: vec![RequiredState::flat(&NEVER_PARSE)],
        export_order: &[],
    };
    let json = json!({"$":{"flat":"nested","only":"raw"},"flat":"flat"});
    let state =
        NodeState::with_stored_import_source(None, json.as_object().expect("literal"), &layout)
            .expect("raw-only allocation");
    assert!(state.known.is_empty());
    assert!(state.unknown.is_none());
    assert_eq!(state.storage_only, ["flat", "only"]);
    let mut exported = crate::SerializedNode::new();
    state.export_stored_reusing(&layout, &mut exported, crate::SerializedNode::new());
    assert_eq!(
        serde_json::to_string(&exported).expect("JSON"),
        r#"{"flat":"flat","$":{"only":"raw"}}"#
    );
    assert_eq!(
        state.imported_raw.as_ref().expect("raw")["flat"].as_deref(),
        Some(&json!("flat"))
    );
    let mut copied = state.clone();
    copied.discard_storage_only();
    assert!(copied.imported_raw.as_ref().expect("raw").is_empty());
    assert_eq!(state.imported_raw.as_ref().expect("raw").len(), 2);
}

#[test]
fn selected_raw_identity_and_retained_absence_survive_original_source_overlay() {
    let value = Arc::new(json!({"selected":true}));
    let state = NodeState {
        imported_raw: Some(
            [
                ("selected".to_owned(), Some(value.clone())),
                ("retained".to_owned(), None),
            ]
            .into_iter()
            .collect(),
        ),
        ..NodeState::default()
    };
    let json = json!({"$":{"selected":"not selected raw","retained":42,"extra":9}});
    let state = NodeState::with_stored_import_source(
        Some(state),
        json.as_object().expect("literal"),
        &StateLayout::default(),
    )
    .expect("existing");
    let raw = state.imported_raw.as_ref().expect("raw");
    assert!(Arc::ptr_eq(
        raw["selected"].as_ref().expect("selected"),
        &value
    ));
    assert!(raw["retained"].is_none());
    assert_eq!(state.storage_only, ["extra"]);
}

#[test]
fn filtered_overlay_preserves_existing_selected_then_restored_completion_order() {
    let mut filtered = json!({"$":{"selected":2}})
        .as_object()
        .expect("literal")
        .clone();
    let state = NodeState::import(&filtered, &StateLayout::default(), None, None, false, &[]);
    filtered = json!({"$":{"dropped":1,"selected":2,"after":3}})
        .as_object()
        .expect("literal")
        .clone();
    let state = NodeState::with_stored_import_source(state, &filtered, &StateLayout::default())
        .expect("state");
    let mut exported = crate::SerializedNode::new();
    state.export_stored_reusing(
        &StateLayout::default(),
        &mut exported,
        crate::SerializedNode::new(),
    );
    assert_eq!(
        serde_json::to_string(&exported).expect("JSON"),
        r#"{"$":{"selected":2,"dropped":1,"after":3}}"#
    );
}
