use super::*;

#[test]
fn artifact_objects_sit_under_their_document_prefix() {
    assert_eq!(
        build_artifact_object_key(
            "01a0914f-1fde-7873-80ba-6eef315d3b50",
            "0f8ca7467b0a55599c03aad0aed980d35f15acafcfa344cfdcd152af3044f7e8"
        ),
        "artifacts/01a0914f-1fde-7873-80ba-6eef315d3b50/0f8ca7467b0a55599c03aad0aed980d35f15acafcfa344cfdcd152af3044f7e8"
    );
    assert_eq!(
        build_artifact_document_prefix("01a0914f-1fde-7873-80ba-6eef315d3b50"),
        "artifacts/01a0914f-1fde-7873-80ba-6eef315d3b50/"
    );
}
