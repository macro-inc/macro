use super::*;
use macro_event_broker::MacroEventCollection as _;
use std::collections::BTreeSet;

/// Every topic is either delivered or explicitly internal, never both and
/// never neither: adding a topic to `macro_event_topics` fails here until it
/// is subscribed or listed in [`INTERNAL_TOPICS`].
#[test]
fn every_topic_is_delivered_or_listed_internal() {
    let delivered: BTreeSet<&str> = DeclaredMacroEvent::topics().iter().copied().collect();
    let internal: BTreeSet<&str> = INTERNAL_TOPICS.iter().copied().collect();
    let all: BTreeSet<&str> = macro_event_topics::all_topic_names()
        .iter()
        .copied()
        .collect();

    assert_eq!(
        internal.len(),
        INTERNAL_TOPICS.len(),
        "duplicate internal topic"
    );
    assert!(
        delivered.is_disjoint(&internal),
        "delivered topics listed internal: {:?}",
        delivered.intersection(&internal).collect::<Vec<_>>()
    );
    let covered: BTreeSet<&str> = delivered.union(&internal).copied().collect();
    assert_eq!(
        covered,
        all,
        "unlisted topics: {:?}; unknown topics: {:?}",
        all.difference(&covered).collect::<Vec<_>>(),
        covered.difference(&all).collect::<Vec<_>>()
    );
}

/// The log writer reads every delivered topic plus exactly the access-change
/// topics.
#[test]
fn the_log_reads_the_delivered_topics_and_the_access_change_topics() {
    let delivered: BTreeSet<&str> = DeclaredMacroEvent::topics().iter().copied().collect();
    let logged: BTreeSet<&str> = LogMacroEvent::topics().iter().copied().collect();
    let access: BTreeSet<&str> = ACCESS_CHANGE_TOPICS.iter().copied().collect();

    assert_eq!(logged, delivered.union(&access).copied().collect());
    assert!(access.iter().all(|topic| INTERNAL_TOPICS.contains(topic)));
}
