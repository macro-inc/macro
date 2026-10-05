#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

#[test]
fn test_isomitted_omitted_optional_arg_returns_true() {
    let mut model = new_empty_model();
    // [b] is optional; calling with only one arg leaves b as EmptyArg → TRUE
    model._set("A1", "=LAMBDA(a, [b], ISOMITTED(b))(12)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"TRUE");
}

#[test]
fn test_isomitted_provided_arg_returns_false() {
    let mut model = new_empty_model();
    model._set("A1", "=LAMBDA(a, [b], ISOMITTED(b))(12, 3)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"FALSE");
}

#[test]
fn test_isomitted_empty_string_is_not_omitted() {
    let mut model = new_empty_model();
    model._set("A1", "=LAMBDA(a, [b], ISOMITTED(b))(12, \"\")");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"FALSE");
}

#[test]
fn test_isomitted_zero_is_not_omitted() {
    let mut model = new_empty_model();
    model._set("A1", "=LAMBDA(a, [b], ISOMITTED(b))(12, 0)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"FALSE");
}

#[test]
fn test_isomitted_wrong_arg_count() {
    let mut model = new_empty_model();
    model._set("A1", "=ISOMITTED()");
    model._set("A2", "=ISOMITTED(1, 2)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"#ERROR!");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
}

#[test]
fn test_isomitted_optional_arg_default_pattern() {
    // Classic ISOMITTED usage: provide a default when the optional arg is missing.
    // LAMBDA(a, [b], IF(ISOMITTED(b), a/2, a*b))
    let mut model = new_empty_model();
    model._set("A1", "=LAMBDA(a, [b], IF(ISOMITTED(b), a/2, a*b))(12)");
    model._set("A2", "=LAMBDA(a, [b], IF(ISOMITTED(b), a/2, a*b))(12, 3)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"6");
    assert_eq!(model._get_text("A2"), *"36");
}
