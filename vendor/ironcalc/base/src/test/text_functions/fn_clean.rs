#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_clean_basic() {
    let mut model = new_empty_model();
    // Tab (char 9) should be removed
    model._set("A1", "=CLEAN(\"hello\tworld\")");
    model._set("A2", "=CLEAN(\"no control chars\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), "helloworld");
    assert_eq!(model._get_text("A2"), "no control chars");
}
