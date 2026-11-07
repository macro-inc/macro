use super::*;
use macro_user_id::user_id::MacroUserIdStr;

fn receipt(entity_id: &str, entity_type: EntityType) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        MacroUserIdStr::try_from_email("reader@example.com").unwrap(),
        entity_id,
        entity_type,
    )
}

#[test]
fn content_receipts_must_be_for_email_threads() {
    let error = email_thread_ids_from_receipts(vec![receipt(
        &Uuid::new_v4().to_string(),
        EntityType::Document,
    )])
    .unwrap_err();

    assert!(matches!(error, EmailErr::Unauthorized));
}

#[test]
fn content_receipts_must_contain_uuid_thread_ids() {
    let error =
        email_thread_ids_from_receipts(vec![receipt("not-a-uuid", EntityType::EmailThread)])
            .unwrap_err();

    assert!(matches!(error, EmailErr::RepoErr(_)));
}

#[test]
fn content_receipts_are_translated_to_a_single_batch() {
    let first = Uuid::new_v4();
    let second = Uuid::new_v4();

    let ids = email_thread_ids_from_receipts(vec![
        receipt(&first.to_string(), EntityType::EmailThread),
        receipt(&second.to_string(), EntityType::EmailThread),
    ])
    .unwrap();

    assert_eq!(ids, vec![first, second]);
}
