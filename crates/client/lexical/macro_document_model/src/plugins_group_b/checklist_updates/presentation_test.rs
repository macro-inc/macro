use super::*;
use crate::EditorType;
use lexical_model::*;
use serde_json::{Value, json};

fn setup() -> (Editor, ChecklistProducer, NodeKey) {
    let editor =
        crate::preset_builder_with_mode(EditorType::MarkdownSync, EditorMode::ViewAttached)
            .initial_state(
                serde_json::from_value(json!({"root": {
                    "type": "root", "children": [{
                        "type": "task-list", "listType": "check", "tag": "ul", "start": 1,
                        "$": {"taskListView": {"filters": {
                            "status": ["done"], "priority": [], "assignees": [], "due": []
                        }}},
                        "children": [{"type": "listitem", "value": 1, "checked": false,
                            "children": [{"type": "text", "text": "Work"}]}]
                    }]
                }}))
                .unwrap(),
            )
            .build()
            .unwrap();
    let key = editor
        .state()
        .view()
        .children(NodeKey::ROOT)
        .next()
        .unwrap();
    let mut producer = ChecklistProducer::default();
    accept_facts(&mut producer, editor.state());
    let setup = producer.finish(editor.state()).unwrap();
    for receipt in &setup {
        producer.expose(receipt);
    }
    assert_eq!(producer.sequence, 1);
    (editor, producer, key)
}

fn accept_facts(producer: &mut ChecklistProducer, state: &EditorState) {
    let mut facts: Value =
        serde_json::from_str(include_str!("../checklist_query/request-example.json")).unwrap();
    facts.as_object_mut().unwrap().remove("listKey");
    facts["factsVersion"] = json!("1");
    let command = crate::surface::decode_command(
        "group-b.set-checklist-facts",
        &facts.to_string(),
        state.max_key().generation(),
        None,
    )
    .unwrap()
    .unwrap();
    let input = Input::Command {
        command,
        selection: ViewSelection::KeepModel,
    };
    producer
        .accept(
            super::super::checklist_facts::input_revision(&input)
                .unwrap()
                .unwrap(),
            state,
        )
        .unwrap();
}

fn input(state: &EditorState, key: NodeKey, sequence: u64, status: &[&str]) -> Input {
    let command = crate::surface::decode_command(
        "group-b.checklist-settings-intent",
        &json!({"key": key.index(), "observedSequence": sequence.to_string(), "settings": {
            "filters": {"status": status, "priority": [], "assignees": [], "due": []}
        }})
        .to_string(),
        state.max_key().generation(),
        None,
    )
    .unwrap()
    .unwrap();
    Input::Command {
        command,
        selection: ViewSelection::KeepModel,
    }
}

fn payload(input: &Input) -> &SettingsIntent {
    super::super::checklist_presentation::input_intent(input)
        .unwrap()
        .unwrap()
}

#[test]
fn access_invalidation_blocks_before_finish_and_advances_even_identical_plan() {
    let (editor, mut producer, key) = setup();
    let before = editor.state().clone();
    let initial = input(editor.state(), key, 1, &["done"]);
    producer
        .set_presentation(payload(&initial), editor.state())
        .unwrap();
    let old = producer.finish(editor.state()).unwrap();
    assert_eq!(producer.sequence, 2);
    assert_eq!(serde_json::to_value(&old).unwrap()[0]["lists"], json!([]));
    let queued = input(editor.state(), key, 2, &["not-started"]);
    assert!(
        producer
            .accepts_presentation(payload(&queued), editor.state())
            .unwrap()
    );

    producer.invalidate_presentation();
    assert!(producer.presentation_overrides.is_empty());
    assert_eq!(
        producer.sequence, 2,
        "allocation stays in the actual output epilogue"
    );
    assert!(
        !producer
            .accepts_presentation(payload(&queued), editor.state())
            .unwrap()
    );
    producer.invalidate_presentation();
    assert!(
        !producer
            .accepts_presentation(payload(&queued), editor.state())
            .unwrap()
    );
    let pending = producer.finish(editor.state()).unwrap();
    assert_eq!(producer.sequence, 3);
    assert!(!producer.presentation_invalidated);
    assert_eq!(
        pending.len(),
        2,
        "old unexposed FIFO debt stays ahead of the new fence"
    );
    assert_eq!(
        serde_json::to_value(&pending).unwrap()[1]["lists"],
        json!([])
    );
    assert!(
        !producer
            .accepts_presentation(payload(&queued), editor.state())
            .unwrap()
    );

    producer.expose(&pending[1]);
    assert_eq!(
        producer.pending_deliveries().len(),
        2,
        "out of order is not an ACK"
    );
    producer.expose(&old[0]);
    assert_eq!(producer.pending_deliveries().len(), 1);
    assert!(
        !producer
            .accepts_presentation(payload(&queued), editor.state())
            .unwrap()
    );
    producer.expose(&pending[1]);
    let current = input(editor.state(), key, 3, &[]);
    assert!(
        producer
            .accepts_presentation(payload(&current), editor.state())
            .unwrap()
    );
    assert!(editor.state().same_snapshot(&before));
}

#[test]
fn no_facts_invalidation_stays_closed_until_actual_new_delivery() {
    let (editor, _, key) = setup();
    let mut producer = ChecklistProducer::default();
    producer.invalidate_presentation();
    assert!(producer.finish(editor.state()).unwrap().is_empty());
    assert!(producer.presentation_invalidated);
    assert_eq!(producer.sequence, 0);
    let attempt = input(editor.state(), key, 1, &[]);
    assert!(
        producer
            .accepts_presentation(payload(&attempt), editor.state())
            .is_err()
    );

    accept_facts(&mut producer, editor.state());
    assert!(producer.presentation_invalidated);
    assert!(
        !producer
            .accepts_presentation(payload(&attempt), editor.state())
            .unwrap()
    );
    let actual = producer.finish(editor.state()).unwrap();
    assert_eq!(actual.len(), 1);
    assert_eq!(producer.sequence, 1);
    assert!(!producer.presentation_invalidated);
    assert!(
        producer
            .accepts_presentation(payload(&attempt), editor.state())
            .unwrap()
    );
}

#[test]
fn failed_reset_draft_does_not_reopen_or_replace_live_presentation() {
    let (editor, mut producer, key) = setup();
    let choice = input(editor.state(), key, 1, &["not-started"]);
    producer
        .set_presentation(payload(&choice), editor.state())
        .unwrap();
    for receipt in producer.finish(editor.state()).unwrap() {
        producer.expose(&receipt);
    }
    let queued = input(editor.state(), key, 2, &[]);
    producer.invalidate_presentation();
    let draft = producer.prepare_reset(editor.state()).unwrap();
    assert_eq!(producer.sequence, 2);
    assert!(producer.presentation_invalidated);
    assert!(
        !producer
            .accepts_presentation(payload(&queued), editor.state())
            .unwrap()
    );
    drop(draft); // Before transfer: the caller discards a failed encode draft.
    assert!(producer.presentation_invalidated);
    assert_eq!(producer.sequence, 2);

    let accepted = producer.prepare_reset(editor.state()).unwrap();
    let wire = serde_json::to_value(accepted.deliveries()).unwrap();
    assert_eq!(wire[0]["sequence"], "3");
    assert_eq!(
        wire[0]["lists"][0]["result"]["settings"]["filters"]["status"],
        json!(["done"])
    );
    producer.expose_reset(accepted);
    assert!(!producer.presentation_invalidated);
    assert!(producer.presentation_overrides.is_empty());
    assert_eq!(producer.sequence, 3);
    assert!(
        !producer
            .accepts_presentation(payload(&queued), editor.state())
            .unwrap()
    );
}

#[test]
fn sequence_exhaustion_drops_choice_and_never_falls_into_writer() {
    let (editor, mut producer, key) = setup();
    let choice = input(editor.state(), key, 1, &["not-started"]);
    producer
        .set_presentation(payload(&choice), editor.state())
        .unwrap();
    producer.sequence = u64::MAX; // Metadata exhaustion fault, not a graph authority.
    let exhausted = input(editor.state(), key, u64::MAX, &["in-progress"]);
    assert!(
        !producer
            .accepts_presentation(payload(&exhausted), editor.state())
            .unwrap()
    );
    assert!(producer.presentation_overrides.is_empty());
    assert!(producer.presentation_invalidated);
    assert!(producer.finish(editor.state()).is_err());
    assert_eq!(producer.sequence, u64::MAX);
    assert!(producer.presentation_invalidated);
    assert!(
        !producer
            .accepts_presentation(payload(&exhausted), editor.state())
            .unwrap()
    );
}

#[test]
fn explicit_empty_is_an_override_and_remote_notification_restores_stored() {
    let (editor, mut producer, key) = setup();
    let choice = input(editor.state(), key, 1, &[]);
    producer
        .set_presentation(payload(&choice), editor.state())
        .unwrap();
    let local = producer.finish(editor.state()).unwrap();
    assert_eq!(
        serde_json::to_value(&local).unwrap()[0]["lists"][0]["changes"]["settings"]["filters"]["status"],
        json!([])
    );
    for receipt in local {
        producer.expose(&receipt);
    }
    assert!(producer.presentation_overrides.contains_key(&key));
    let draft = producer.prepare_reset(editor.state()).unwrap();
    assert_eq!(
        serde_json::to_value(draft.deliveries()).unwrap()[0]["lists"][0]["result"]["settings"]["filters"]
            ["status"],
        json!([])
    );
    drop(draft);
    producer.remote_applied();
    assert!(producer.presentation_overrides.is_empty());
    let restored = producer.finish(editor.state()).unwrap();
    assert_eq!(
        serde_json::to_value(&restored).unwrap()[0]["lists"][0]["changes"]["settings"]["filters"]["status"],
        json!(["done"])
    );
}
