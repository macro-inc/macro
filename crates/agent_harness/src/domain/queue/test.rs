use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId};
use agent_session::domain::model::AgentSessionId;

use super::*;

fn prompt_entry(text: &str) -> QueuedEntry {
    QueuedEntry {
        action_id: AgentActionId::mint(),
        action: AgentAction::prompt(text),
        actor: None,
        announce: None,
        announced: None,
        created_at: Utc::now(),
    }
}

fn prompt_text(action: &AgentAction) -> &str {
    match action {
        AgentAction::Prompt(prompt) => &prompt.prompt,
        other => panic!("expected a prompt, got {other:?}"),
    }
}

#[test]
fn entries_come_back_out_oldest_first() {
    let queues = SessionQueues::new();
    let session = AgentSessionId::TEST_A;
    let first = prompt_entry("first");
    let second = prompt_entry("second");
    queues.enqueue(session, first.clone()).unwrap();
    queues.enqueue(session, second.clone()).unwrap();

    assert_eq!(
        queues
            .list(session)
            .iter()
            .map(|entry| entry.action_id)
            .collect::<Vec<_>>(),
        [first.action_id, second.action_id]
    );
    assert_eq!(
        queues.claim_next(session).unwrap().action_id,
        first.action_id
    );
    assert_eq!(
        queues.claim_next(session).unwrap().action_id,
        second.action_id
    );
    assert!(queues.claim_next(session).is_none());
    assert!(queues.list(session).is_empty());
}

#[test]
fn sessions_do_not_share_a_queue() {
    let queues = SessionQueues::new();
    queues
        .enqueue(AgentSessionId::TEST_A, prompt_entry("a's work"))
        .unwrap();

    assert!(queues.claim_next(AgentSessionId::TEST_B).is_none());
    assert!(queues.list(AgentSessionId::TEST_B).is_empty());
    assert_eq!(queues.list(AgentSessionId::TEST_A).len(), 1);
}

#[test]
fn editing_replaces_the_text_and_keeps_the_place() {
    let queues = SessionQueues::new();
    let session = AgentSessionId::TEST_A;
    let first = prompt_entry("first");
    let second = prompt_entry("second");
    queues.enqueue(session, first.clone()).unwrap();
    queues.enqueue(session, second.clone()).unwrap();

    queues
        .edit_prompt(session, first.action_id, "rewritten".to_owned(), None)
        .unwrap();

    let claimed = queues.claim_next(session).unwrap();
    assert_eq!(claimed.action_id, first.action_id);
    assert_eq!(prompt_text(&claimed.action), "rewritten");
}

#[test]
fn editing_reattributes_the_entry_to_the_editor() {
    let queues = SessionQueues::new();
    let session = AgentSessionId::TEST_A;
    let mut first = prompt_entry("first");
    first.actor = Some(MacroUserIdStr::try_from_email("asker@example.com").unwrap());
    queues.enqueue(session, first.clone()).unwrap();

    let editor = MacroUserIdStr::try_from_email("editor@example.com").unwrap();
    queues
        .edit_prompt(
            session,
            first.action_id,
            "rewritten".to_owned(),
            Some(editor.clone()),
        )
        .unwrap();

    let claimed = queues.claim_next(session).unwrap();
    assert_eq!(claimed.actor.as_ref(), Some(&editor));
    assert_eq!(prompt_text(&claimed.action), "rewritten");
}

#[test]
fn a_claimed_entry_is_gone_for_editing_and_removal() {
    let queues = SessionQueues::new();
    let session = AgentSessionId::TEST_A;
    let entry = prompt_entry("work");
    queues.enqueue(session, entry.clone()).unwrap();
    queues.claim_next(session).unwrap();

    assert_eq!(
        queues.edit_prompt(session, entry.action_id, "late".to_owned(), None),
        Err(QueueError::NotFound)
    );
    assert_eq!(
        queues.remove(session, entry.action_id),
        Err(QueueError::NotFound)
    );
}

#[test]
fn only_prompts_are_editable() {
    let queues = SessionQueues::new();
    let session = AgentSessionId::TEST_A;
    let compact = QueuedEntry {
        action_id: AgentActionId::mint(),
        action: AgentAction::Compact,
        actor: None,
        announce: None,
        announced: None,
        created_at: Utc::now(),
    };
    queues.enqueue(session, compact.clone()).unwrap();

    assert_eq!(
        queues.edit_prompt(session, compact.action_id, "text".to_owned(), None),
        Err(QueueError::NotEditable)
    );
    // Still removable.
    queues.remove(session, compact.action_id).unwrap();
}

#[test]
fn removal_skips_the_removed_entry_at_dispatch() {
    let queues = SessionQueues::new();
    let session = AgentSessionId::TEST_A;
    let first = prompt_entry("first");
    let second = prompt_entry("second");
    queues.enqueue(session, first.clone()).unwrap();
    queues.enqueue(session, second.clone()).unwrap();

    queues.remove(session, first.action_id).unwrap();

    assert_eq!(
        queues.claim_next(session).unwrap().action_id,
        second.action_id
    );
}

#[test]
fn mark_announced_remembers_the_chip_on_the_waiting_entry() {
    let queues = SessionQueues::new();
    let session = AgentSessionId::TEST_A;
    let first = prompt_entry("first");
    let second = prompt_entry("second");
    queues.enqueue(session, first.clone()).unwrap();
    queues.enqueue(session, second.clone()).unwrap();

    let chip = Uuid::from_u128(0xc1);
    queues
        .mark_announced(session, second.action_id, chip)
        .unwrap();

    assert_eq!(queues.claim_next(session).unwrap().announced, None);
    assert_eq!(queues.claim_next(session).unwrap().announced, Some(chip));
}

#[test]
fn a_requeued_entry_is_next_in_line() {
    let queues = SessionQueues::new();
    let session = AgentSessionId::TEST_A;
    let first = prompt_entry("first");
    let second = prompt_entry("second");
    queues.enqueue(session, first.clone()).unwrap();
    queues.enqueue(session, second.clone()).unwrap();

    let claimed = queues.claim_next(session).unwrap();
    queues.requeue_front(session, claimed);

    assert_eq!(
        queues.claim_next(session).unwrap().action_id,
        first.action_id
    );
}

#[test]
fn enqueue_front_puts_the_entry_ahead_of_waiting_work() {
    let queues = SessionQueues::new();
    let session = AgentSessionId::TEST_A;
    let waiting = prompt_entry("queued earlier");
    let steer = prompt_entry("steer");
    queues.enqueue(session, waiting.clone()).unwrap();
    queues.enqueue_front(session, steer.clone()).unwrap();

    assert_eq!(
        queues
            .list(session)
            .iter()
            .map(|entry| entry.action_id)
            .collect::<Vec<_>>(),
        [steer.action_id, waiting.action_id]
    );
    assert_eq!(
        queues.claim_next(session).unwrap().action_id,
        steer.action_id
    );
    assert_eq!(
        queues.claim_next(session).unwrap().action_id,
        waiting.action_id
    );
}

#[test]
fn a_snapshot_round_trips_through_the_durable_shape() {
    let session = AgentSessionId::TEST_A;
    let mut entry = prompt_entry("keep me");
    entry.announce = Some(AnnounceOrigin {
        parent: messages::domain::models::MessageParent::Channel(Uuid::from_u128(0xf0)),
        thread_id: Uuid::from_u128(0xf1),
        message_id: Uuid::from_u128(0xf2),
    });
    entry.announced = Some(Uuid::from_u128(0xf3));
    let queues = SessionQueues::new();
    queues.enqueue(session, entry.clone()).unwrap();

    let stored = queues.snapshot(session)[0].to_stored().unwrap();
    let restored = QueuedEntry::from_stored(stored).unwrap();
    assert_eq!(restored.action_id, entry.action_id);
    assert_eq!(prompt_text(&restored.action), "keep me");
    assert_eq!(restored.announce, entry.announce);
    assert_eq!(restored.announced, entry.announced);

    let other = SessionQueues::new();
    other.replace(session, vec![restored]);
    assert_eq!(other.list(session).len(), 1);
    assert_eq!(
        prompt_text(&other.claim_next(session).unwrap().action),
        "keep me"
    );
}

#[test]
fn the_cap_refuses_the_overflowing_entry() {
    let queues = SessionQueues::new();
    let session = AgentSessionId::TEST_A;
    for n in 0..QUEUE_CAP {
        queues
            .enqueue(session, prompt_entry(&format!("{n}")))
            .unwrap();
    }

    assert_eq!(
        queues.enqueue(session, prompt_entry("one too many")),
        Err(QueueError::Full)
    );
    assert_eq!(
        queues.enqueue_front(session, prompt_entry("nor at the front")),
        Err(QueueError::Full)
    );
}
