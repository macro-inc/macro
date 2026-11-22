use lexical_model::*;
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct MenuNode {}
impl NodeType for MenuNode {
    const TYPE: &'static str = "menu-dependency-fixture";
    type Kind = ElementKind;
    lexical_model::impl_default_node!();
}
impl ElementNode for MenuNode {
    lexical_model::element_node_base!();
}

#[test]
fn action_dependency_query_uses_the_configured_registry_without_creating_nodes() -> Result<(), Error>
{
    let editor = Editor::builder(EditorMode::Headless)
        .node::<MenuNode>()
        .build()
        .expect("editor");
    let state = editor.state();
    let before = state.to_json()?;
    let generation = state.max_key().generation();
    for (types, available) in [
        (json!([]), true),
        (json!(["menu-dependency-fixture"]), true),
        (json!(["menu-dependency-fixture", "missing"]), false),
    ] {
        let reply = crate::surface::query_editor(
            "group-a.action-dependencies",
            &json!({"types":types}),
            generation,
            &editor,
        )?;
        assert_eq!(reply, Some(json!({"available":available})));
    }
    assert_eq!(editor.state().to_json()?, before);
    assert_eq!(editor.state().max_key(), state.max_key());
    Ok(())
}

#[test]
fn action_dependency_query_rejects_stale_before_strict_payload_decode() -> Result<(), Error> {
    let editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let generation = editor.state().max_key().generation();
    let invalid = json!({"types":[null],"extra":true});
    let stale = crate::surface::query_editor(
        "group-a.action-dependencies",
        &invalid,
        generation + 1,
        &editor,
    );
    assert!(matches!(
        stale,
        Err(Error::Invariant("application query generation"))
    ));
    assert!(
        crate::surface::query_editor("group-a.action-dependencies", &invalid, generation, &editor,)
            .is_err()
    );
    assert_eq!(
        crate::surface::query_editor("unrecognized", &invalid, generation + 1, &editor)?,
        None
    );
    Ok(())
}

#[test]
fn action_dependency_query_requires_an_object_instead_of_positional_fields() -> Result<(), Error> {
    let editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let generation = editor.state().max_key().generation();
    for data in [json!([]), json!([[]]), json!([["text"]]), json!(null)] {
        assert!(crate::surface::query_editor(
            "group-a.action-dependencies", &data, generation, &editor,
        ).is_err(), "object-only payload: {data}");
        assert!(matches!(
            crate::surface::query_editor(
                "group-a.action-dependencies",
                &data,
                generation + 1,
                &editor,
            ),
            Err(Error::Invariant("application query generation"))
        ));
    }
    Ok(())
}
