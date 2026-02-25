use super::*;

fn depriority_labels() -> Vec<String> {
    DEPRIORITY_LABELS.iter().map(|s| s.to_string()).collect()
}

#[test]
fn test_importance_none_is_noop() {
    let mut include = vec![];
    let mut exclude = vec![];
    apply_email_importance(None, &mut include, &mut exclude);

    assert!(include.is_empty());
    assert!(exclude.is_empty());
}

#[test]
fn test_importance_true_excludes_depriority_labels() {
    let mut include = vec![];
    let mut exclude = vec![];
    apply_email_importance(Some(true), &mut include, &mut exclude);

    assert!(include.is_empty());
    assert_eq!(exclude, depriority_labels());
}

#[test]
fn test_importance_false_includes_depriority_labels() {
    let mut include = vec![];
    let mut exclude = vec![];
    apply_email_importance(Some(false), &mut include, &mut exclude);

    assert_eq!(include, depriority_labels());
    assert!(exclude.is_empty());
}

#[test]
fn test_importance_true_does_not_duplicate_existing_labels() {
    let mut include = vec![];
    let mut exclude = vec!["CATEGORY_PROMOTIONS".to_string()];
    apply_email_importance(Some(true), &mut include, &mut exclude);

    assert!(include.is_empty());
    assert_eq!(
        exclude
            .iter()
            .filter(|l| *l == "CATEGORY_PROMOTIONS")
            .count(),
        1
    );
    assert_eq!(exclude.len(), DEPRIORITY_LABELS.len());
}
