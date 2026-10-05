use super::*;

#[test]
fn values_replace_their_key() {
    let list = with_value(None, "a", Some("1")).unwrap();
    let list = with_value(Some(&list), "a", Some("2")).unwrap();
    assert_eq!(list.len(), 1);
    assert!(with_value(Some(&list), "a", None).is_none());
}
