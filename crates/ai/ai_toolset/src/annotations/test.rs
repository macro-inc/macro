use super::*;

#[test]
fn read_only_maps_to_read_only_hint_only() {
    let annotations = ToolAnnotations::read_only("Read document");
    assert!(annotations.kind.read_only_hint());
    assert!(!annotations.kind.destructive_hint());
}

#[test]
fn additive_sets_neither_hint() {
    let annotations = ToolAnnotations::additive("Create document");
    assert!(!annotations.kind.read_only_hint());
    assert!(!annotations.kind.destructive_hint());
}

#[test]
fn destructive_sets_destructive_hint_only() {
    let annotations = ToolAnnotations::destructive("Delete tag");
    assert!(!annotations.kind.read_only_hint());
    assert!(annotations.kind.destructive_hint());
}

#[test]
fn no_kind_sets_both_hints() {
    // The pair readOnlyHint == destructiveHint == true is meaningless in MCP.
    // Modelling the two booleans as one enum makes it unrepresentable.
    for kind in [
        ToolKind::ReadOnly,
        ToolKind::Additive,
        ToolKind::Destructive,
    ] {
        assert!(
            !(kind.read_only_hint() && kind.destructive_hint()),
            "{kind:?} claims to be both read-only and destructive"
        );
    }
}

#[test]
fn reads_default_to_idempotent_and_closed_world() {
    let annotations = ToolAnnotations::read_only("Search content");
    assert!(annotations.idempotent);
    assert!(!annotations.open_world);
}

#[test]
fn writes_default_to_non_idempotent() {
    assert!(!ToolAnnotations::additive("Create project").idempotent);
    assert!(!ToolAnnotations::destructive("Edit document").idempotent);
}

#[test]
fn builders_override_defaults() {
    let annotations = ToolAnnotations::additive("Import Notion page")
        .with_open_world()
        .with_idempotent();
    assert!(annotations.open_world);
    assert!(annotations.idempotent);

    let annotations = ToolAnnotations::read_only("Fetch a web page").without_idempotent();
    assert!(!annotations.idempotent);
}

#[test]
fn annotations_are_const_constructible() {
    // The whole enforcement story depends on these being usable as an
    // associated const, so pin that they evaluate at compile time.
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Send channel message").with_open_world();
    assert_eq!(ANNOTATIONS.title, "Send channel message");
    assert_eq!(ANNOTATIONS.kind, ToolKind::Destructive);
    assert!(ANNOTATIONS.open_world);
}
