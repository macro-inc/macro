use super::*;
use serde_json::json;

/// The loop Gemini rejected in the `DisplayResults` view filter: `not`
/// requires a `clause`, and a clause may be another combination.
#[test]
fn a_loop_through_a_required_property_and_an_any_of_branch_is_found() {
    let schema = json!({
        "type": "object",
        "properties": { "filter": { "$ref": "#/$defs/Combination" } },
        "$defs": {
            "Combination": {
                "anyOf": [
                    {
                        "type": "object",
                        "properties": {
                            "op": { "const": "and" },
                            "clauses": { "type": "array", "items": { "$ref": "#/$defs/Combination" } }
                        },
                        "required": ["op", "clauses"]
                    },
                    {
                        "type": "object",
                        "properties": {
                            "op": { "const": "not" },
                            "clause": {
                                "anyOf": [
                                    { "$ref": "#/$defs/Combination" },
                                    { "type": "object", "properties": { "include": { "type": "string" } } }
                                ]
                            }
                        },
                        "required": ["op", "clause"]
                    }
                ]
            }
        }
    });
    assert_eq!(
        required_ref_loop(&schema).as_deref(),
        Some("$defs.Combination.anyOf.1.properties.clause.anyOf.0")
    );
}

#[test]
fn a_loop_with_a_way_out_is_accepted() {
    let ways_out = [
        json!({ "type": "object", "properties": { "next": { "$ref": "#/$defs/Node" } } }),
        json!({
            "type": "object",
            "properties": { "next": { "anyOf": [{ "$ref": "#/$defs/Node" }, { "type": "null" }] } },
            "required": ["next"]
        }),
        json!({
            "type": "object",
            "properties": { "next": { "type": "array", "items": { "$ref": "#/$defs/Node" } } },
            "required": ["next"]
        }),
        json!({
            "type": "object",
            "properties": { "next": { "type": "array", "items": { "$ref": "#/$defs/Node" }, "minItems": 0 } },
            "required": ["next"]
        }),
    ];
    for node in ways_out {
        let schema = json!({
            "type": "object",
            "properties": { "root": { "$ref": "#/$defs/Node" } },
            "required": ["root"],
            "$defs": { "Node": node }
        });
        assert_eq!(required_ref_loop(&schema), None, "{schema}");
    }
}

#[test]
fn a_loop_through_a_list_that_cannot_be_empty_is_found() {
    let schema = json!({
        "type": "object",
        "properties": { "root": { "$ref": "#/$defs/Node" } },
        "$defs": {
            "Node": {
                "type": "object",
                "properties": {
                    "children": { "type": "array", "items": { "$ref": "#/$defs/Node" }, "minItems": 1 }
                },
                "required": ["children"]
            }
        }
    });
    assert_eq!(
        required_ref_loop(&schema).as_deref(),
        Some("$defs.Node.properties.children.items")
    );
}

#[test]
fn a_loop_across_definitions_and_the_root_is_found() {
    let schema = json!({
        "type": "object",
        "properties": { "child": { "$ref": "#/$defs/Child" } },
        "required": ["child"],
        "$defs": {
            "Child": {
                "type": "object",
                "properties": { "parent": { "$ref": "#" } },
                "required": ["parent"]
            }
        }
    });
    assert_eq!(
        required_ref_loop(&schema).as_deref(),
        Some("$defs.Child.properties.parent")
    );
}
