//! AI authoring of branching: a created section's show-when rules name
//! earlier questions by key, a read returns them, and edits that do not
//! mention them keep them.
use super::authoring_workflow::{Access, Editor};
use super::*;
use crate::domain::authoring::ports::FormsAuthoringService;
use crate::domain::authoring::workflow::AuthoringWorkflow;
use crate::domain::authoring::*;
use serde_json::json;

#[tokio::test]
async fn a_created_show_when_reads_back_and_survives_an_edit_that_does_not_mention_it() {
    let world = world();
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        booking: (),
        access: Access(world.clone()),
        editor: Editor,
        app_origin: "https://macro.test".into(),
    };
    let intent: Create = serde_json::from_value(json!({
        "name": "Offsite", "source": {"kind":"new"},
        "draft": {"sections":[
            {"kind":"questions","key":"about","questions":[
                {"key":"role","column":{"kind":"new","name":"Role","type":{"type":"select","multi":false},"options":[
                    {"key":"employee","label":"Employee"},{"key":"contractor","label":"Contractor"}]},"required":true}
            ]},
            {"kind":"questions","key":"logistics","title":"Logistics","questions":[
                {"key":"diet","column":{"kind":"new","name":"Diet","type":{"type":"text"}},"required":true}
            ],"showWhen":{"conjunction":"and","conditions":[
                {"kind":"condition","question":{"key":"role"},"test":{"kind":"options","operator":"isAnyOf","options":[{"key":"employee"}]}}
            ]}}
        ]}
    }))
    .unwrap();

    let created = workflow.create_form(viewer(OWNER), intent).await.unwrap();

    assert_eq!(
        created.state,
        MutationState::Completed,
        "{:?}",
        created.diagnostics
    );
    let form_id = created.form_id;
    let logistics = created.keys.sections["logistics"];
    let expected = FilterGroup {
        conjunction: Conjunction::And,
        conditions: vec![FilterNode::Condition(FilterCondition {
            column: created.keys.columns["role"],
            test: FilterTest::Options {
                operator: SetOperator::IsAnyOf,
                options: vec![created.keys.options["role"]["employee"]],
            },
        })],
    };
    let ReadResult::Authoring { saved, .. } = workflow
        .read_form(
            viewer(OWNER),
            Read {
                form_id,
                view: ReadView::Authoring,
                include_summary: false,
            },
        )
        .await
        .unwrap()
    else {
        panic!("authoring");
    };
    let FormSection::Questions { show_when, .. } = &saved.layout.sections[1] else {
        panic!("questions");
    };
    assert_eq!(show_when, &Some(expected.clone()));

    let renamed = workflow
        .edit_form(
            viewer(OWNER),
            Edit {
                form_id,
                changes: vec![Change::SetSectionText {
                    section_id: logistics,
                    title: Some("Travel".into()),
                    description: None,
                    message: None,
                }],
                new_columns: vec![],
                description: None,
                confirmation_message: None,
            },
        )
        .await
        .unwrap();

    assert_eq!(
        renamed.state,
        MutationState::Completed,
        "{:?}",
        renamed.diagnostics
    );
    let FormSection::Questions {
        title, show_when, ..
    } = &renamed.saved.as_ref().unwrap().layout.sections[1]
    else {
        panic!("questions");
    };
    assert_eq!(title, "Travel");
    assert_eq!(show_when, &Some(expected));

    let cleared = workflow
        .edit_form(
            viewer(OWNER),
            Edit {
                form_id,
                changes: vec![Change::SetShowWhen {
                    section_id: logistics,
                    show_when: None,
                }],
                new_columns: vec![],
                description: None,
                confirmation_message: None,
            },
        )
        .await
        .unwrap();

    let FormSection::Questions { show_when, .. } =
        &cleared.saved.as_ref().unwrap().layout.sections[1]
    else {
        panic!("questions");
    };
    assert_eq!(show_when, &None);
}

#[tokio::test]
async fn an_edit_naming_the_sections_own_question_in_show_when_is_refused_before_any_write() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let workflow = AuthoringWorkflow {
        core: Arc::new(service(&world)),
        databases: Arc::new(FakeDatabases(world.clone())),
        booking: (),
        access: Access(world.clone()),
        editor: Editor,
        app_origin: "https://macro.test".into(),
    };

    let refused = workflow
        .edit_form(
            viewer(OWNER),
            Edit {
                form_id: RSVP_FORM,
                changes: vec![Change::SetShowWhen {
                    section_id: LOGISTICS,
                    show_when: Some(FilterGroup {
                        conjunction: Conjunction::And,
                        conditions: vec![FilterNode::Condition(FilterCondition {
                            column: DIET,
                            test: FilterTest::Presence {
                                operator: databases_types::views::PresenceOperator::IsEmpty,
                            },
                        })],
                    }),
                }],
                new_columns: vec![],
                description: None,
                confirmation_message: None,
            },
        )
        .await
        .unwrap_err();

    assert_eq!(refused.code, Code::ShowWhenReferencesLaterQuestion);
    assert_eq!(world.lock().unwrap().layouts[&RSVP_FORM], rsvp_layout());
}
