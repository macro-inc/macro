use std::collections::HashSet;

use super::*;

#[test]
fn all_topic_names_is_non_empty_and_unique() {
    let names = all_topic_names();
    assert!(!names.is_empty());

    let unique: HashSet<_> = names.iter().collect();
    assert_eq!(
        unique.len(),
        names.len(),
        "duplicate topic names: {names:?}"
    );
}

#[test]
fn all_topic_names_includes_declared_topics() {
    assert!(all_topic_names().contains(&MacroExampleTopic.as_str()));
    assert!(all_topic_names().contains(&MacroDocumentsTopic.as_str()));
    assert!(all_topic_names().contains(&MacroChannelsTopic.as_str()));
}
