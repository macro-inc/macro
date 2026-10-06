use crate::domain::{model::*, service::Reviews};
use crate::testing::*;

fn presentation() -> Presentation {
    serde_json::from_value(serde_json::json!({
        "fileGroups": [{"key":"support", "title":"Supporting code", "files":["src/**"], "hidden":true}]
    })).unwrap()
}

#[tokio::test]
async fn groups_are_revision_bound_and_expand_patterns_without_changing_the_specification() {
    let f = Fixture::new();
    f.service
        .capture(agent(), Comparison::default(), presentation())
        .await
        .unwrap();
    let first = f.service.view(agent(), None).await.unwrap().unwrap();
    assert_eq!(first.file_groups[0].files, ["src/main.rs"]);
    assert!(first.file_groups[0].hidden);
    assert_eq!(first.revisions[0].file_groups[0].files, ["src/**"]);
    *f.source.0.lock().unwrap() = capture("// moved\nfn main() {\n    hello();\n}");
    f.service
        .capture(agent(), Comparison::default(), Presentation::default())
        .await
        .unwrap();
    let current = f.service.view(agent(), None).await.unwrap().unwrap();
    assert_eq!(current.file_groups[0].files, ["src/main.rs"]);
    let previous = f.service.view(agent(), Some(1)).await.unwrap().unwrap();
    assert_eq!(previous.file_groups[0].files, ["src/main.rs"]);
    assert!(previous.revisions[1].file_groups.is_empty());
}

#[tokio::test]
async fn invalid_groups_do_not_replace_published_metadata() {
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
    let valid = f.service.view(agent(), None).await.unwrap().unwrap();
    assert_eq!(valid.file_groups[0].files, ["src/main.rs"]);
    assert_eq!(valid.version, 1);
}

#[tokio::test]
async fn omitted_groups_are_preserved_and_an_empty_collection_clears_them() {
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
    assert_eq!(existing.file_groups.len(), 1);
    let clear = serde_json::from_value(serde_json::json!({"fileGroups":[]})).unwrap();
    f.service.annotate(agent(), 1, clear).await.unwrap();
    let empty = f.service.view(agent(), None).await.unwrap().unwrap();
    assert!(empty.file_groups.is_empty());
}
