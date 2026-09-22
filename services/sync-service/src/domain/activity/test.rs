use super::*;

fn human(name: &str) -> DocumentAttribution {
    DocumentAttribution {
        actor: format!("macro|{name}@example.com"),
        on_behalf_of: None,
    }
}

#[test]
fn repeated_edits_are_deduplicated_until_the_notification_takes_them() {
    let mut pending = PendingEditors::default();
    let author = human("alice");
    for _ in 0..100 {
        pending.record(&author);
    }
    assert_eq!(pending.take(), vec![author.clone()]);
    assert!(pending.take().is_empty());
    pending.record(&author);
    assert_eq!(pending.take(), vec![author]);
}

#[test]
fn preserves_distinct_humans_agents_and_represented_users() {
    let mut pending = PendingEditors::default();
    let alice = human("alice");
    let bob = human("bob");
    let agent = |user: &str| DocumentAttribution {
        actor: "bot|editor".into(),
        on_behalf_of: Some(user.into()),
    };
    let editors = vec![
        alice.clone(),
        bob.clone(),
        agent(&alice.actor),
        agent(&bob.actor),
    ];
    for editor in &editors {
        pending.record(editor);
        pending.record(editor);
    }
    assert_eq!(pending.take(), editors);
}
