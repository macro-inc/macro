//! Reading a form and replacing its layout: what a layout put accepts and
//! every way it is refused.

use entity_access::domain::models::{EditAccessLevel, ViewAccessLevel};
use models_databases::views::{DateOperator, TextOperator};

use super::*;
use crate::domain::models::{FormAccess, FormError, FormSectionDetail, LayoutProblem};
use crate::domain::ports::FormsService;

#[test]
fn respondent_details_withhold_the_booking_destination() {
    let form = Form {
        id: FormId::from_uuid(Uuid::from_u128(1)),
        name: "Interview".into(),
        description: "".into(),
        owner_id: OWNER.into(),
        database_id: DatabaseId::from_uuid(Uuid::from_u128(2)),
        table_id: TableId::from_uuid(Uuid::from_u128(3)),
        submitted_column_id: None,
        respondent_column_id: None,
        audience: Audience::Public,
        tally_visible: false,
        status: FormStatus::Open,
        closes_at: None,
        confirmation_message: "Thank you".into(),
        created_at: start_of_tests(),
        updated_at: start_of_tests(),
    };
    let layout = FormLayout {
        sections: vec![FormSection::Booking {
            id: FormSectionId::from_uuid(Uuid::from_u128(4)),
            title: "Book a time".into(),
            description: "Meet with us".into(),
            target: models_forms::BookingTarget {
                profile_id: models_forms::BookingProfileId::from_uuid(Uuid::from_u128(5)),
                event_type_id: models_forms::BookingEventTypeId::from_uuid(Uuid::from_u128(6)),
            },
        }],
    };
    for access in [FormAccess::View, FormAccess::Edit, FormAccess::Owner] {
        let detail = super::super::layout::form_detail(form.clone(), access, layout.clone(), None);
        let wire = serde_json::to_value(detail).unwrap();
        assert_eq!(
            wire["sections"][0].get("target").is_some(),
            access != FormAccess::View
        );
        assert_eq!(wire["sections"][0]["title"], "Book a time");
    }
}

#[tokio::test]
async fn booking_must_follow_every_question_and_screener() {
    let world = world();
    seed_rsvp(&world, Audience::Public);
    let booking = FormSection::Booking {
        id: FormSectionId::from_uuid(Uuid::from_u128(0xb00)),
        title: "Book a time".into(),
        description: "".into(),
        target: models_forms::BookingTarget {
            profile_id: models_forms::BookingProfileId::from_uuid(Uuid::from_u128(5)),
            event_type_id: models_forms::BookingEventTypeId::from_uuid(Uuid::from_u128(6)),
        },
    };
    let mut layout = rsvp_layout();
    layout.sections.insert(1, booking);
    assert!(matches!(
        put(&world, layout).await,
        Err(FormError::InvalidLayout(LayoutProblem::BookingMustBeLast))
    ));
}

async fn put(
    world: &Shared,
    layout: FormLayout,
) -> Result<models_forms::FormCollaboration, FormError> {
    service(world)
        .put_layout(
            form_receipt::<EditAccessLevel>(RSVP_FORM, EDITOR, AccessLevel::Edit),
            layout,
        )
        .await
}

fn with_questions(questions: Vec<QuestionLayout>) -> FormLayout {
    FormLayout {
        sections: vec![FormSection::Questions {
            id: ABOUT_YOU,
            title: "".into(),
            description: "".into(),
            questions,
        }],
    }
}

fn question(id: u128, column: ColumnId, widget: Option<Widget>) -> QuestionLayout {
    QuestionLayout {
        id: FormQuestionId::from_uuid(Uuid::from_u128(id)),
        column,
        help_text: "".into(),
        required: false,
        widget,
    }
}

#[tokio::test]
async fn a_viewer_reads_the_layout_with_its_gate_rules_and_their_own_access() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let detail = service(&world)
        .get_form(form_receipt::<ViewAccessLevel>(
            RSVP_FORM,
            VIEWER,
            AccessLevel::View,
        ))
        .await
        .unwrap();
    assert_eq!(detail.access, FormAccess::View);
    assert!(!detail.table_gone);
    assert_eq!(detail.sections.len(), 3);
    let FormSectionDetail::Gate { rules, .. } = &detail.sections[1] else {
        panic!("the second section is the gate");
    };
    let FormSection::Gate {
        rules: stored_rules,
        ..
    } = &rsvp_layout().sections[1]
    else {
        panic!("the stored gate");
    };
    assert_eq!(rules, stored_rules);
}

#[tokio::test]
async fn a_form_over_a_trashed_database_reads_as_table_gone_with_no_questions() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    world.lock().unwrap().database_mut(RSVP_DATABASE).trashed = true;
    let detail = service(&world)
        .get_form(form_receipt::<ViewAccessLevel>(
            RSVP_FORM,
            OWNER,
            AccessLevel::Owner,
        ))
        .await
        .unwrap();
    assert!(detail.table_gone);
    for section in &detail.sections {
        if let FormSectionDetail::Questions { questions, .. } = section {
            assert!(questions.is_empty());
        }
    }
    assert!(matches!(
        put(&world, rsvp_layout()).await,
        Err(FormError::TableGone)
    ));
}

#[tokio::test]
async fn a_question_whose_column_was_deleted_drops_out_of_the_detail() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    world.lock().unwrap().database_mut(RSVP_DATABASE).tables[0]
        .columns
        .retain(|column| column.id != DIET);
    let detail = service(&world)
        .get_form(form_receipt::<ViewAccessLevel>(
            RSVP_FORM,
            VIEWER,
            AccessLevel::View,
        ))
        .await
        .unwrap();
    let FormSectionDetail::Questions { questions, .. } = &detail.sections[2] else {
        panic!("logistics");
    };
    assert_eq!(questions.len(), 1);
    assert_eq!(questions[0].id, PLUS_ONE_QUESTION);
}

#[tokio::test]
async fn a_valid_layout_replaces_the_old_one_and_stamps_the_form() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    world.lock().unwrap().now = Utc.with_ymd_and_hms(2026, 9, 5, 9, 0, 0).unwrap();
    let layout = with_questions(vec![
        question(1, NOTES, Some(Widget::Paragraph)),
        question(2, TEAM, Some(Widget::Dropdown)),
    ]);
    let detail = put(&world, layout.clone()).await.unwrap();
    assert_eq!(detail.detail.access, FormAccess::Edit);
    assert_eq!(
        detail.detail.form.updated_at,
        Utc.with_ymd_and_hms(2026, 9, 5, 9, 0, 0).unwrap()
    );
    let world = world.lock().unwrap();
    assert_eq!(world.layouts.get(&RSVP_FORM), Some(&layout));
    assert_eq!(
        world.forms[0].form.updated_at,
        Utc.with_ymd_and_hms(2026, 9, 5, 9, 0, 0).unwrap()
    );
}

#[tokio::test]
async fn a_layout_naming_a_column_the_table_lacks_or_the_form_writes_is_refused() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let stray = ColumnId::from_uuid(Uuid::from_u128(0x5719));
    assert!(matches!(
        put(&world, with_questions(vec![question(1, stray, None)])).await,
        Err(FormError::InvalidLayout(LayoutProblem::UnknownColumn { column })) if column == stray
    ));
    assert!(matches!(
        put(&world, with_questions(vec![question(1, SUBMITTED, None)])).await,
        Err(FormError::InvalidLayout(LayoutProblem::ManagedColumn {
            column: SUBMITTED
        }))
    ));
    assert!(matches!(
        put(&world, with_questions(vec![question(1, RESPONDENT, None)])).await,
        Err(FormError::InvalidLayout(LayoutProblem::ManagedColumn {
            column: RESPONDENT
        }))
    ));
    assert_eq!(
        world.lock().unwrap().layouts.get(&RSVP_FORM),
        Some(&rsvp_layout())
    );
}

#[tokio::test]
async fn a_layout_asking_a_column_twice_or_reusing_an_id_is_refused() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    assert!(matches!(
        put(
            &world,
            with_questions(vec![question(1, TEAM, None), question(2, TEAM, None)])
        )
        .await,
        Err(FormError::InvalidLayout(LayoutProblem::RepeatedColumn {
            column: TEAM
        }))
    ));
    assert!(matches!(
        put(
            &world,
            with_questions(vec![question(1, TEAM, None), question(1, NOTES, None)])
        )
        .await,
        Err(FormError::InvalidLayout(LayoutProblem::RepeatedId { .. }))
    ));
    let section_and_question_share_an_id = FormLayout {
        sections: vec![FormSection::Questions {
            id: FormSectionId::from_uuid(Uuid::from_u128(7)),
            title: "".into(),
            description: "".into(),
            questions: vec![question(7, TEAM, None)],
        }],
    };
    assert!(matches!(
        put(&world, section_and_question_share_an_id).await,
        Err(FormError::InvalidLayout(LayoutProblem::RepeatedId { .. }))
    ));
}

#[tokio::test]
async fn a_widget_must_fit_its_column_and_a_public_form_asks_for_no_file() {
    let world = world();
    seed_rsvp(&world, Audience::Public);
    assert!(matches!(
        put(
            &world,
            with_questions(vec![question(1, TEAM, Some(Widget::Checkboxes))])
        )
        .await,
        Err(FormError::WidgetMismatch { .. })
    ));
    assert!(matches!(
        put(
            &world,
            with_questions(vec![question(1, PLUS_ONE, Some(Widget::Short))])
        )
        .await,
        Err(FormError::WidgetMismatch { .. })
    ));
    world.lock().unwrap().database_mut(RSVP_DATABASE).tables[0]
        .columns
        .push(FakeColumn {
            id: ColumnId::from_uuid(Uuid::from_u128(0xf11e)),
            name: "Resume".into(),
            kind: ColumnKind::Link,
            options: vec![],
        });
    assert!(matches!(
        put(
            &world,
            with_questions(vec![question(
                1,
                ColumnId::from_uuid(Uuid::from_u128(0xf11e)),
                Some(Widget::File)
            )])
        )
        .await,
        Err(FormError::FileUploadNeedsSignIn)
    ));
    put(
        &world,
        with_questions(vec![question(
            1,
            ColumnId::from_uuid(Uuid::from_u128(0xf11e)),
            Some(Widget::Url),
        )]),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn a_gate_may_test_only_columns_asked_before_it_as_a_view_filter_would() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let gate_on = |test: FilterTest, column: ColumnId| FormLayout {
        sections: vec![
            FormSection::Questions {
                id: ABOUT_YOU,
                title: "".into(),
                description: "".into(),
                questions: vec![question(1, TEAM, None), question(2, START_DATE, None)],
            },
            FormSection::Gate {
                id: ELIGIBILITY,
                title: "".into(),
                description: "".into(),
                rules: FilterGroup {
                    conjunction: Conjunction::And,
                    conditions: vec![FilterNode::Condition(FilterCondition { column, test })],
                },
                message: "No".into(),
            },
            FormSection::Questions {
                id: LOGISTICS,
                title: "".into(),
                description: "".into(),
                questions: vec![question(3, DIET, None)],
            },
        ],
    };

    // Diet is asked after the gate.
    assert!(matches!(
        put(
            &world,
            gate_on(
                FilterTest::Text {
                    operator: TextOperator::Contains,
                    value: "vegan".into(),
                },
                DIET
            )
        )
        .await,
        Err(FormError::InvalidLayout(
            LayoutProblem::GateNamesLaterColumn { column: DIET }
        ))
    ));
    // Notes is never asked.
    assert!(matches!(
        put(
            &world,
            gate_on(
                FilterTest::Text {
                    operator: TextOperator::Contains,
                    value: "x".into(),
                },
                NOTES
            )
        )
        .await,
        Err(FormError::InvalidLayout(
            LayoutProblem::GateNamesLaterColumn { column: NOTES }
        ))
    ));
    // A text test does not fit a date column.
    assert!(matches!(
        put(
            &world,
            gate_on(
                FilterTest::Text {
                    operator: TextOperator::Is,
                    value: "soon".into(),
                },
                START_DATE
            )
        )
        .await,
        Err(FormError::InvalidLayout(LayoutProblem::GateRule { .. }))
    ));
    // A multi-value operator does not fit a single select.
    assert!(matches!(
        put(
            &world,
            gate_on(
                FilterTest::Options {
                    operator: SetOperator::HasAll,
                    options: vec![EMPLOYEE],
                },
                TEAM
            )
        )
        .await,
        Err(FormError::InvalidLayout(LayoutProblem::GateRule { .. }))
    ));
    put(
        &world,
        gate_on(
            FilterTest::Date {
                operator: DateOperator::OnOrAfter,
                value: start_of_tests(),
            },
            START_DATE,
        ),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn texts_longer_than_allowed_are_refused() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let long_title = FormLayout {
        sections: vec![FormSection::Questions {
            id: ABOUT_YOU,
            title: "x".repeat(201),
            description: "".into(),
            questions: vec![],
        }],
    };
    assert!(matches!(
        put(&world, long_title).await,
        Err(FormError::InvalidLayout(LayoutProblem::TextTooLong {
            max: 200
        }))
    ));
    let mut long_help = question(1, TEAM, None);
    long_help.help_text = "x".repeat(10_001);
    assert!(matches!(
        put(&world, with_questions(vec![long_help])).await,
        Err(FormError::InvalidLayout(LayoutProblem::TextTooLong {
            max: 10_000
        }))
    ));
}

#[tokio::test]
async fn a_layout_may_leave_every_question_off_and_have_no_sections() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let detail = put(&world, FormLayout { sections: vec![] }).await.unwrap();
    assert!(detail.detail.sections.is_empty());
}

#[tokio::test]
async fn a_trashed_form_has_no_layout_to_read_or_put() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    world.lock().unwrap().forms[0].trashed_at = Some(start_of_tests());
    assert!(matches!(
        service(&world)
            .get_form(form_receipt::<ViewAccessLevel>(
                RSVP_FORM,
                OWNER,
                AccessLevel::Owner
            ))
            .await,
        Err(FormError::NotFound)
    ));
    assert!(matches!(
        put(&world, rsvp_layout()).await,
        Err(FormError::NotFound)
    ));
}

#[tokio::test]
async fn macros_own_machinery_reads_a_form_at_owner() {
    let world = world();
    seed_rsvp(&world, Audience::Members);
    let detail = service(&world)
        .get_form(
            EntityAccessReceipt::<ViewAccessLevel>::dangerously_assert_internal_user(
                &RSVP_FORM.to_string(),
                EntityType::Form,
            ),
        )
        .await
        .unwrap();
    assert_eq!(detail.access, FormAccess::Owner);
}
