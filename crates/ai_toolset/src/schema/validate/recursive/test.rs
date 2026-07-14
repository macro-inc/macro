use std::cell::RefCell;

use schemars::json_schema;

use super::*;

/// Records the `title` of every visited node, erroring on a title of "bad".
struct RecordTitles {
    visited: RefCell<Vec<String>>,
}

impl RecordTitles {
    fn new() -> Self {
        Self {
            visited: RefCell::new(Vec::new()),
        }
    }

    fn visited(&self) -> Vec<String> {
        self.visited.borrow().clone()
    }
}

impl Validate for RecordTitles {
    fn validate(&self, schema: &Schema) -> Result<(), ValidationError> {
        if let Some(title) = schema.get("title").and_then(|title| title.as_str()) {
            if title == "bad" {
                return Err(ValidationError::OneOf);
            }
            self.visited.borrow_mut().push(title.to_string());
        }
        Ok(())
    }
}

#[test]
fn visits_root_and_all_subschema_containers() {
    let schema = json_schema!({
        "title": "root",
        "properties": {
            "a": { "title": "in_properties" }
        },
        "items": { "title": "in_items" },
        "prefixItems": [
            { "title": "in_prefix_items" }
        ],
        "anyOf": [
            { "title": "in_any_of" }
        ],
        "$defs": {
            "d": { "title": "in_defs" }
        },
        "additionalProperties": { "title": "in_additional_properties" },
        "not": { "title": "in_not" }
    });

    let validator = RecursiveValidate(RecordTitles::new());
    validator.validate(&schema).unwrap();

    let visited = validator.0.visited();
    for expected in [
        "root",
        "in_properties",
        "in_items",
        "in_prefix_items",
        "in_any_of",
        "in_defs",
        "in_additional_properties",
        "in_not",
    ] {
        assert!(
            visited.iter().any(|title| title == expected),
            "expected to visit {expected:?}, visited: {visited:?}"
        );
    }
}

#[test]
fn visits_deeply_nested_nodes() {
    let schema = json_schema!({
        "title": "root",
        "properties": {
            "outer": {
                "title": "outer",
                "items": {
                    "title": "inner",
                    "properties": {
                        "leaf": { "title": "leaf" }
                    }
                }
            }
        }
    });

    let validator = RecursiveValidate(RecordTitles::new());
    validator.validate(&schema).unwrap();

    assert_eq!(
        validator.0.visited(),
        vec!["root", "outer", "inner", "leaf"]
    );
}

#[test]
fn visits_parent_before_child() {
    let schema = json_schema!({
        "title": "parent",
        "properties": {
            "a": { "title": "child" }
        }
    });

    let validator = RecursiveValidate(RecordTitles::new());
    validator.validate(&schema).unwrap();

    assert_eq!(validator.0.visited(), vec!["parent", "child"]);
}

#[test]
fn error_propagates_and_stops_validation() {
    let schema = json_schema!({
        "title": "root",
        "properties": {
            "a": {
                "title": "bad",
                "properties": {
                    "unreachable": { "title": "below_bad" }
                }
            }
        }
    });

    let validator = RecursiveValidate(RecordTitles::new());
    let result = validator.validate(&schema);

    assert!(matches!(result, Err(ValidationError::OneOf)));
    assert_eq!(
        validator.0.visited(),
        vec!["root"],
        "nodes after the failing node must not be validated"
    );
}
