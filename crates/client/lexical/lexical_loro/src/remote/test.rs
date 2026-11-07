use super::*;
#[test]
fn deltas_past_the_end_are_divergence_errors_instead_of_panics() {
    let mut text = "a😀b".to_owned();
    let mut changes = Vec::new();
    assert!(matches!(
        apply_delta(
            NodeKey::ROOT,
            &mut text,
            &[loro::TextDelta::Retain {
                retain: 4,
                attributes: None
            }],
            &mut changes
        ),
        Err(ProjectionError::Diverged { .. })
    ));
    assert!(changes.is_empty());
    assert!(matches!(
        apply_delta(
            NodeKey::ROOT,
            &mut text,
            &[loro::TextDelta::Delete { delete: 4 }],
            &mut changes
        ),
        Err(ProjectionError::Diverged { .. })
    ));
    assert_eq!(text, "a😀b");
}
