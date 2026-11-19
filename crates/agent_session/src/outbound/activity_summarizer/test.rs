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

#[test]
fn the_prompt_names_every_step_that_says_nothing_about_the_work() {
    for label in agent_fold::domain::model::UNNAMED_STEP_LABELS {
        assert!(
            super::ACTIVITY_SUMMARY_SYSTEM_PROMPT.contains(&format!("\"{label}\"")),
            "the summarizer prompt does not name {label:?}"
        );
    }
}
