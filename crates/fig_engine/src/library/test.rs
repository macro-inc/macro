use super::*;

#[test]
fn private_names() {
    assert!(is_private("_Base"));
    assert!(is_private(".hidden"));
    assert!(!is_private("Button"));
}
