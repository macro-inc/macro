use super::*;

#[test]
fn a_tab_choice_with_three_escaped_titles_fits_the_written_key() {
    let object = NotionId::parse(&"a".repeat(32)).unwrap();
    let escaped_title = r#"\""#.repeat(512);
    let mut fact = SourceLossFact {
        object: object.clone(),
        detail: SourceLossDetail::Notice {
            notice: ImportNotice {
                object: object.clone(),
                source: escaped_title.clone(),
                kind: ImportNoticeKind::TabChosen {
                    view_id: object.clone(),
                    view: escaped_title.clone(),
                    page_id: Some(object),
                    container_title: Some(escaped_title),
                },
            },
        },
    };
    fact.bound_display_text();
    // Leave space for the other columns in the written marker's btree key.
    assert!(serde_json::to_string(&fact).unwrap().len() < 2500);
}

#[test]
fn reference_losses_agree_with_one_and_two_occurrences() {
    for (reason, one, two) in [
        (
            ReferenceLossReason::NotReviewed,
            "was not reviewed; kept as a named Notion link",
            "were not reviewed; kept as named Notion links",
        ),
        (
            ReferenceLossReason::NotImported,
            "was not imported as a database; kept as a named Notion link",
            "were not imported as a database; kept as named Notion links",
        ),
        (
            ReferenceLossReason::NoAccess,
            "could not be read; kept as a named Notion link",
            "could not be read; kept as named Notion links",
        ),
        (
            ReferenceLossReason::NotFound,
            "was not found; kept as a named Notion link",
            "were not found; kept as named Notion links",
        ),
        (
            ReferenceLossReason::Unresolved,
            "could not be resolved; kept as a named Notion link",
            "could not be resolved; kept as named Notion links",
        ),
        (
            ReferenceLossReason::DefaultTabAssumed,
            "had no selected tab; default tab assumed",
            "had no selected tab; default tab assumed",
        ),
        (
            ReferenceLossReason::DefaultView,
            "used the default view because the selected tab was unavailable",
            "used the default view because the selected tab was unavailable",
        ),
    ] {
        for (count, noun, explanation) in [(1, "reference", one), (2, "references", two)] {
            let warning = FidelityWarning::References {
                reason,
                title: "Work".into(),
                count,
            };
            assert_eq!(
                warning.render(),
                format!("{count} {noun} to database \"Work\" {explanation}.")
            );
        }
    }
}

#[test]
fn value_people_and_unsupported_counts_agree_at_one_and_two() {
    for (count, value_prefix, people_sentence, unsupported_prefix) in [
        (
            1,
            "1 value of option \"New\" in \"Status\" was omitted:",
            "1 person assignment in database “Work”, property “Owner”, could not be matched to Macro users and was omitted.",
            "1 unsupported warning entry could not be displayed;",
        ),
        (
            2,
            "2 values of option \"New\" in \"Status\" were omitted:",
            "2 people assignments in database “Work”, property “Owner”, could not be matched to Macro users and were omitted.",
            "2 unsupported warning entries could not be displayed;",
        ),
    ] {
        assert!(
            FidelityWarning::OmittedOptions {
                property: "Status".into(),
                option: "New".into(),
                matched_by: OptionMatch::Id,
                count
            }
            .render()
            .starts_with(value_prefix)
        );
        assert_eq!(
            FidelityWarning::UnmappedPeople {
                source: "Work".into(),
                property: "Owner".into(),
                count
            }
            .render(),
            people_sentence
        );
        assert!(
            FidelityWarning::UnsupportedEntries {
                unsupported_entries: count
            }
            .render()
            .starts_with(unsupported_prefix)
        );
    }
}
