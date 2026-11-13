use super::*;

#[test]
fn a_bare_run_refuses_to_reimport_every_link() {
    let refused = links(None, false, ReimportMode::Apply).unwrap_err();
    let message = refused.to_string();
    assert!(message.contains("LINK_IDS"), "{message}");
    assert!(message.contains("ALL_LINKS=true"), "{message}");
}

#[test]
fn every_link_needs_all_links_or_a_dry_run() {
    assert_eq!(links(None, true, ReimportMode::Apply).unwrap(), None);
    assert_eq!(links(None, false, ReimportMode::Verify).unwrap(), None);
}

#[test]
fn named_links_run_in_their_order_and_exclude_all_links() {
    let second = Uuid::now_v7();
    let first = Uuid::now_v7();
    assert_eq!(
        links(Some(vec![first, second]), false, ReimportMode::Apply).unwrap(),
        Some(vec![first, second])
    );
    assert!(links(Some(vec![first]), true, ReimportMode::Apply).is_err());
}
