use crate::domain::{model::*, service::Reviews};
use crate::testing::*;

fn presentation() -> Presentation {
    serde_json::from_value(serde_json::json!({
        "fileGroups": [{"key":"support", "title":"Supporting code", "files":["src/**"], "hidden":true}],
        "graph": {
            "title":"Entry point",
            "direction":"topToBottom",
            "nodes":[{"id":"main", "title":"Main", "kind":"Entry", "description":"Dispatch the request.", "files":["src/**"], "location":{"path":"src/main.rs", "side":"new", "line":2}}],
            "edges":[]
        }
    })).unwrap()
}

#[tokio::test]
async fn groups_and_graphs_are_revision_bound_and_follow_changed_code() {
    let f = Fixture::new();
    f.service
        .capture(agent(), Comparison::default(), presentation())
        .await
        .unwrap();
    let first = f.service.view(agent(), None).await.unwrap().unwrap();
    assert_eq!(first.file_groups[0].files, ["src/main.rs"]);
    assert!(first.file_groups[0].hidden);
    // Reading expands patterns without altering the saved agent specification.
    assert_eq!(first.revisions[0].file_groups[0].files, ["src/**"]);
    let graph = first.graph.unwrap();
    assert_eq!(graph.nodes[0].files, ["src/main.rs"]);
    assert_eq!(
        graph.nodes[0].description.as_deref(),
        Some("Dispatch the request.")
    );
    assert_eq!(
        first.revisions[0].graph.as_ref().unwrap().nodes[0].files,
        ["src/**"]
    );
    *f.source.0.lock().unwrap() = capture("// moved\nfn main() {\n    hello();\n}");
    f.service
        .capture(agent(), Comparison::default(), Presentation::default())
        .await
        .unwrap();
    let current = f.service.view(agent(), None).await.unwrap().unwrap();
    assert_eq!(current.graph.unwrap().nodes[0].location.line, 3);
    let previous = f.service.view(agent(), Some(1)).await.unwrap().unwrap();
    assert_eq!(previous.graph.unwrap().nodes[0].location.line, 2);
    assert_eq!(previous.file_groups[0].files, ["src/main.rs"]);
    assert!(previous.revisions[1].file_groups.is_empty());
    assert!(previous.revisions[1].graph.is_none());
}

#[tokio::test]
async fn invalid_groups_or_map_links_do_not_replace_published_metadata() {
    let f = Fixture::new();
    f.service
        .capture(agent(), Comparison::default(), presentation())
        .await
        .unwrap();
    let mut invalid = presentation();
    invalid.file_groups.as_mut().unwrap()[0].files = vec!["missing/**".into()];
    assert!(matches!(
        f.service.annotate(agent(), 1, invalid).await,
        Err(ReviewError::Invalid(_))
    ));
    let mut invalid = presentation();
    invalid.graph.as_mut().unwrap().nodes[0].location.line = 9999;
    assert!(f.service.annotate(agent(), 1, invalid).await.is_err());
    let mut invalid = presentation();
    invalid.graph.as_mut().unwrap().nodes[0].files = vec!["missing/**".into()];
    assert!(matches!(
        f.service.annotate(agent(), 1, invalid).await,
        Err(ReviewError::Invalid(_))
    ));
    let mut invalid = presentation();
    invalid.graph.as_mut().unwrap().nodes[0].description = Some("x".repeat(181));
    assert!(matches!(
        f.service.annotate(agent(), 1, invalid).await,
        Err(ReviewError::Invalid(_))
    ));
    let mut invalid = presentation();
    invalid.graph.as_mut().unwrap().edges.push(GraphEdge {
        from: "main".into(),
        to: "missing".into(),
        label: "calls".into(),
        location: None,
    });
    assert!(matches!(
        f.service.annotate(agent(), 1, invalid).await,
        Err(ReviewError::Invalid(_))
    ));
    let valid = f.service.view(agent(), None).await.unwrap().unwrap();
    assert_eq!(valid.graph.unwrap().nodes[0].location.line, 2);
    assert_eq!(valid.file_groups[0].files, ["src/main.rs"]);
    assert_eq!(valid.version, 1);
}

#[tokio::test]
async fn omitted_metadata_is_preserved_and_empty_collections_clear_it() {
    let f = Fixture::new();
    f.service
        .capture(agent(), Comparison::default(), presentation())
        .await
        .unwrap();
    f.service
        .annotate(agent(), 1, Presentation::default())
        .await
        .unwrap();
    let existing = f.service.view(agent(), None).await.unwrap().unwrap();
    assert!(existing.graph.is_some());
    let clear = serde_json::from_value(
        serde_json::json!({"fileGroups":[],"graph":{"title":"Map", "nodes":[],"edges":[]}}),
    )
    .unwrap();
    f.service.annotate(agent(), 1, clear).await.unwrap();
    let empty = f.service.view(agent(), None).await.unwrap().unwrap();
    assert!(empty.graph.is_none());
    assert!(empty.file_groups.is_empty());
}

#[tokio::test]
async fn component_members_follow_secondary_file_renames_without_rewriting_globs() {
    let f = Fixture::new();
    let mut initial = capture("fn main() {\n    helper();\n}");
    let mut helper = initial.snapshot.files[0].clone();
    helper.path = "src/helper.rs".into();
    initial.snapshot.files.push(helper);
    *f.source.0.lock().unwrap() = initial.clone();
    let mut metadata = presentation();
    metadata.graph.as_mut().unwrap().nodes[0].files =
        vec!["./src/helper.rs".into(), "src/main.*".into()];
    f.service
        .capture(agent(), Comparison::default(), metadata)
        .await
        .unwrap();

    initial.snapshot.files[1].old_path = Some("src/helper.rs".into());
    initial.snapshot.files[1].path = "lib/helper.rs".into();
    *f.source.0.lock().unwrap() = initial;
    f.service
        .capture(agent(), Comparison::default(), Presentation::default())
        .await
        .unwrap();
    let current = f.service.view(agent(), None).await.unwrap().unwrap();
    assert_eq!(
        current.graph.unwrap().nodes[0].files,
        ["src/main.rs", "lib/helper.rs"]
    );
    assert_eq!(
        current.revisions[1].graph.as_ref().unwrap().nodes[0].files,
        ["lib/helper.rs", "src/main.*"]
    );
    let previous = f.service.view(agent(), Some(1)).await.unwrap().unwrap();
    assert_eq!(
        previous.graph.unwrap().nodes[0].files,
        ["src/main.rs", "src/helper.rs"]
    );
}

#[tokio::test]
async fn hierarchy_validation_is_atomic_and_supports_four_levels() {
    let f = Fixture::new();
    let mut metadata = presentation();
    let graph = metadata.graph.as_mut().unwrap();
    for (id, parent) in [
        ("service", "main"),
        ("module", "service"),
        ("function", "module"),
    ] {
        let mut node = graph.nodes[0].clone();
        node.id = id.into();
        node.parent = Some(parent.into());
        graph.nodes.push(node);
    }
    f.service
        .capture(agent(), Comparison::default(), metadata.clone())
        .await
        .unwrap();
    for parent in ["missing", "main", "function"] {
        let mut invalid = metadata.clone();
        invalid.graph.as_mut().unwrap().nodes[0].parent = Some(parent.into());
        assert!(matches!(
            f.service.annotate(agent(), 1, invalid).await,
            Err(ReviewError::Invalid(_))
        ));
    }
    let mut too_deep = metadata;
    let graph = too_deep.graph.as_mut().unwrap();
    let mut node = graph.nodes[0].clone();
    node.id = "expression".into();
    node.parent = Some("function".into());
    graph.nodes.push(node);
    assert!(matches!(
        f.service.annotate(agent(), 1, too_deep).await,
        Err(ReviewError::Invalid(_))
    ));
    let view = f.service.view(agent(), None).await.unwrap().unwrap();
    assert_eq!(view.version, 1);
    let nodes = view.graph.unwrap().nodes;
    assert_eq!(nodes.len(), 4);
    assert_eq!(nodes[3].parent.as_deref(), Some("module"));
}

#[tokio::test]
async fn surviving_details_are_promoted_when_the_parent_file_leaves_the_diff() {
    let f = Fixture::new();
    let mut initial = capture("fn main() {\n    helper();\n}");
    let mut helper = initial.snapshot.files[0].clone();
    helper.path = "src/helper.rs".into();
    initial.snapshot.files.push(helper);
    *f.source.0.lock().unwrap() = initial.clone();
    let mut metadata = presentation();
    let graph = metadata.graph.as_mut().unwrap();
    let mut detail = graph.nodes[0].clone();
    detail.id = "helper".into();
    detail.parent = Some("main".into());
    detail.location.path = "src/helper.rs".into();
    graph.nodes.push(detail);
    f.service
        .capture(agent(), Comparison::default(), metadata)
        .await
        .unwrap();
    initial.snapshot.files.remove(0);
    *f.source.0.lock().unwrap() = initial;
    f.service
        .capture(agent(), Comparison::default(), Presentation::default())
        .await
        .unwrap();
    let current = f
        .service
        .view(agent(), None)
        .await
        .unwrap()
        .unwrap()
        .graph
        .unwrap();
    assert_eq!(current.nodes.len(), 1);
    assert_eq!(current.nodes[0].id, "helper");
    assert!(current.nodes[0].parent.is_none());
    let previous = f
        .service
        .view(agent(), Some(1))
        .await
        .unwrap()
        .unwrap()
        .graph
        .unwrap();
    assert_eq!(previous.nodes[1].parent.as_deref(), Some("main"));
}
