use super::*;
use entity_access::domain::models::EntityType;
use macro_user_id::user_id::MacroUserIdStr;

#[test]
fn inaccessible_blocker_status_is_only_reflected_in_the_aggregate() {
    let task_id = Uuid::from_u128(1);
    let blocker_id = Uuid::from_u128(2);
    let mut facts = TaskDependencyState {
        task_id,
        blocker_ids: vec![blocker_id],
        dependent_ids: vec![],
        open_blocker_ids: vec![blocker_id],
    };

    let pending = facts.visible_state(&[]);
    assert!(pending.is_blocked);
    assert!(pending.visible_blocker_ids.is_empty());
    assert!(pending.open_blocker_ids.is_empty());

    // Completed and deleted prerequisites both disappear from canonical open facts.
    facts.open_blocker_ids.clear();
    let closed = facts.visible_state(&[]);
    assert!(!closed.is_blocked);
    assert!(closed.visible_blocker_ids.is_empty());
    assert!(closed.open_blocker_ids.is_empty());
    assert_eq!(facts.blocker_ids, vec![blocker_id]);
}

#[test]
fn mixed_visibility_redacts_only_individual_private_facts() {
    let visible_id = Uuid::from_u128(2);
    let hidden_id = Uuid::from_u128(3);
    let receipt = ViewReceipt::dangerously_assert_authenticated_user(
        MacroUserIdStr::parse_from_str("macro|viewer@example.com").expect("valid fixture user"),
        &visible_id.to_string(),
        EntityType::Document,
    );
    let mut facts = TaskDependencyState {
        task_id: Uuid::from_u128(1),
        blocker_ids: vec![visible_id, hidden_id],
        dependent_ids: vec![],
        open_blocker_ids: vec![visible_id, hidden_id],
    };

    let pending = facts.visible_state(std::slice::from_ref(&receipt));
    assert!(pending.is_blocked);
    assert_eq!(pending.visible_blocker_ids, vec![visible_id]);
    assert_eq!(pending.open_blocker_ids, vec![visible_id]);

    facts.open_blocker_ids = vec![hidden_id];
    let visible_completed = facts.visible_state(&[receipt]);
    assert!(visible_completed.is_blocked);
    assert_eq!(visible_completed.visible_blocker_ids, vec![visible_id]);
    assert!(visible_completed.open_blocker_ids.is_empty());
}

#[test]
fn unrelated_or_non_document_receipts_do_not_disclose_blocker_facts() {
    let blocker_id = Uuid::from_u128(2);
    let user =
        MacroUserIdStr::parse_from_str("macro|viewer@example.com").expect("valid fixture user");
    let receipts = [
        ViewReceipt::dangerously_assert_authenticated_user(
            user.clone(),
            &blocker_id.to_string(),
            EntityType::Project,
        ),
        ViewReceipt::dangerously_assert_authenticated_user(
            user,
            &Uuid::from_u128(3).to_string(),
            EntityType::Document,
        ),
    ];
    let facts = TaskDependencyState {
        task_id: Uuid::from_u128(1),
        blocker_ids: vec![blocker_id],
        dependent_ids: vec![],
        open_blocker_ids: vec![blocker_id],
    };
    let state = facts.visible_state(&receipts);
    assert!(state.is_blocked);
    assert!(state.visible_blocker_ids.is_empty());
    assert!(state.open_blocker_ids.is_empty());
}
