use super::*;

#[test]
fn nothing_deferred_omits_the_section() {
    assert_eq!(render(&[]), None);
}

#[test]
fn lists_each_tool_by_name_with_its_first_sentence() {
    let section = render(&[
        (
            "EditPresentation",
            "Edit a PowerPoint (.pptx) presentation: an ordered batch of operations. \
             To make a new deck from an existing one, pass saveAs.",
        ),
        ("ListReminders", "List the user's reminders"),
    ])
    .unwrap();

    assert_eq!(
        section,
        "# More Macro Tools\n\
         These tools are available too, but their parameters are not loaded yet. \
         To use one, call `LoadTools` with its exact name (load several at once if \
         the task needs them), then call it on your next step. `SearchTools` also \
         finds them by keyword. Once loaded, a tool stays loaded for the rest of \
         the conversation.\n\
         - EditPresentation: Edit a PowerPoint (.pptx) presentation: an ordered batch of operations.\n\
         - ListReminders: List the user's reminders\n"
    );
}

#[test]
fn a_long_unbroken_description_is_cut() {
    let description = "word ".repeat(100);
    let section = render(&[("Long", &description)]).unwrap();
    let line = section.lines().last().unwrap();

    assert_eq!(
        line.chars().count(),
        "- Long: ".len() + MAX_SUMMARY_CHARS + 1
    );
    assert!(line.ends_with('…'));
}
