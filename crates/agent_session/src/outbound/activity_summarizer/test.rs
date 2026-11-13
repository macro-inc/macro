use super::clean_summary;

#[test]
fn a_count_the_model_adds_is_dropped() {
    assert_eq!(
        clean_summary("Searching your workspace (7)…").as_deref(),
        Some("Searching your workspace…")
    );
    assert_eq!(
        clean_summary("\"Creating launch checklist tasks (12)...\"").as_deref(),
        Some("Creating launch checklist tasks...")
    );
    assert_eq!(
        clean_summary("Reading the Q3 plan (2)").as_deref(),
        Some("Reading the Q3 plan")
    );
}

#[test]
fn a_line_without_a_count_is_kept() {
    assert_eq!(
        clean_summary("\nEditing the Q3 plan…\nextra").as_deref(),
        Some("Editing the Q3 plan…")
    );
    assert_eq!(clean_summary("  \n "), None);
    assert_eq!(clean_summary("(3)…"), None);
}
