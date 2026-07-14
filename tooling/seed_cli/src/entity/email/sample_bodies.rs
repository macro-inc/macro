//! Loads sample email body content from embedded files.

use std::collections::HashMap;

/// A pair of (plaintext body, html body).
pub type SampleBody = (String, String);

/// All available sample body template names.
pub const TEMPLATE_NAMES: &[&str] = &[
    "meeting_followup",
    "project_update",
    "quick_question",
    "welcome",
    "invoice",
];

/// Load all sample email bodies as a map of template name to (plaintext, html).
pub fn load_sample_bodies() -> HashMap<String, SampleBody> {
    HashMap::from([
        (
            "meeting_followup".to_string(),
            (
                include_str!("sample_bodies/meeting_followup.txt").to_string(),
                include_str!("sample_bodies/meeting_followup.html").to_string(),
            ),
        ),
        (
            "project_update".to_string(),
            (
                include_str!("sample_bodies/project_update.txt").to_string(),
                include_str!("sample_bodies/project_update.html").to_string(),
            ),
        ),
        (
            "quick_question".to_string(),
            (
                include_str!("sample_bodies/quick_question.txt").to_string(),
                include_str!("sample_bodies/quick_question.html").to_string(),
            ),
        ),
        (
            "welcome".to_string(),
            (
                include_str!("sample_bodies/welcome.txt").to_string(),
                include_str!("sample_bodies/welcome.html").to_string(),
            ),
        ),
        (
            "invoice".to_string(),
            (
                include_str!("sample_bodies/invoice.txt").to_string(),
                include_str!("sample_bodies/invoice.html").to_string(),
            ),
        ),
    ])
}
