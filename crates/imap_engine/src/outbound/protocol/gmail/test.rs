use super::*;
#[test]
fn custom_labels_use_modified_utf7_and_preserve_system_labels() {
    let labels =
        std::collections::BTreeSet::from(["Envoyés".into(), "A&B".into(), "\\Inbox".into()]);
    assert_eq!(
        wire_labels(&labels).unwrap(),
        r#""A&-B" "Envoy&AOk-s" "\\Inbox""#
    );
}
