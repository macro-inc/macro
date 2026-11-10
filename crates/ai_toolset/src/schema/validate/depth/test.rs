use super::*;
use serde_json::json;

/// Wraps `leaf` in `levels` objects that each hold it under property `a`.
fn nested_objects(levels: usize, leaf: Value) -> Value {
    (0..levels).fold(
        leaf,
        |inner, _| json!({ "type": "object", "properties": { "a": inner } }),
    )
}

// Each case is a schema Gemini (gemini-3.8-flash) accepted or rejected with
// 400 INVALID_ARGUMENT.

#[test]
fn thirty_levels_are_accepted() {
    let schema = nested_objects(
        14,
        json!({ "type": "array", "items": { "type": "string" } }),
    );
    assert_eq!(nesting_depth(&schema), 30);
    assert!(validate_gemini_nesting_depth(&Schema::try_from(schema).unwrap()).is_ok());
}

#[test]
fn thirty_one_levels_are_rejected_at_the_deepest_path() {
    let schema = nested_objects(15, json!({ "type": "string" }));
    let error = validate_gemini_nesting_depth(&Schema::try_from(schema).unwrap()).unwrap_err();
    let ValidationError::TooDeep { depth, path } = error else {
        panic!("expected TooDeep, got {error:?}");
    };
    assert_eq!(depth, 31);
    assert_eq!(path, ["properties.a"; 15].join(".") + ".type");
}

#[test]
fn empty_containers_add_no_level() {
    let schema = nested_objects(15, json!({}));
    assert_eq!(nesting_depth(&schema), 30);
    assert!(validate_gemini_nesting_depth(&Schema::try_from(schema).unwrap()).is_ok());
}

#[test]
fn a_type_list_or_enum_at_the_leaf_adds_a_level() {
    for leaf in [
        json!({ "type": ["string", "null"] }),
        json!({ "type": "string", "enum": ["a", "b"] }),
    ] {
        let schema = nested_objects(14, json!({ "type": "array", "items": leaf }));
        assert_eq!(nesting_depth(&schema), 31);
        assert!(validate_gemini_nesting_depth(&Schema::try_from(schema).unwrap()).is_err());
    }
}
