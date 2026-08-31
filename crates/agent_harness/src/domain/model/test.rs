use super::*;

#[test]
fn a_top_level_mention_is_not_quoted() {
    let id = Uuid::from_u128(1);
    assert!(!quotes_prompt(id, id));
}

#[test]
fn an_in_thread_prompt_is_quoted() {
    assert!(quotes_prompt(Uuid::from_u128(1), Uuid::from_u128(2)));
}
