//! A booking step's destination is stored in its own column, apart from the
//! gate rules, and a stored destination the domain could not have written is
//! refused rather than read past.

use models_forms::{BookingEventTypeId, BookingProfileId, BookingTarget};

use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_booking_step_reads_back_with_its_target_in_its_own_column(pool: PgPool) {
    let table = insert_table(&pool).await;
    let repo = PgFormsRepo::new(pool.clone());
    let form = form_over(&table);
    let booking = FormSectionId::from_uuid(Uuid::from_u128(0x5e04));
    let profile = BookingProfileId::from_uuid(Uuid::from_u128(0xb001));
    let event_type = BookingEventTypeId::from_uuid(Uuid::from_u128(0xb002));
    let layout = FormLayout {
        sections: vec![
            FormSection::Questions {
                id: FormSectionId::new(),
                title: "About you".into(),
                description: "".into(),
                questions: vec![QuestionLayout {
                    id: FormQuestionId::new(),
                    column: table.first,
                    help_text: "Your team".into(),
                    required: true,
                    widget: None,
                }],
            },
            FormSection::Gate {
                id: FormSectionId::new(),
                title: "Check".into(),
                description: "".into(),
                rules: FilterGroup {
                    conjunction: Conjunction::And,
                    conditions: vec![FilterNode::Condition(FilterCondition {
                        column: table.first,
                        test: FilterTest::Presence {
                            operator: PresenceOperator::IsNotEmpty,
                        },
                    })],
                },
                message: "Answer first".into(),
            },
            FormSection::Booking {
                id: booking,
                title: "Book your travel call".into(),
                description: "Pick a time with the offsite team.".into(),
                target: BookingTarget {
                    profile_id: profile,
                    event_type_id: event_type,
                },
            },
        ],
    };
    repo.create_form(&form, &layout, false).await.unwrap();

    assert_eq!(repo.layout(form.id).await.unwrap(), layout);
    let stored = sqlx::query!(
        r#"SELECT kind, gate_rules, gate_message, booking_target FROM form_sections WHERE id = $1"#,
        booking.into_uuid(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored.kind, "booking");
    assert_eq!(stored.gate_rules, None);
    assert_eq!(stored.gate_message, "");
    assert_eq!(
        stored.booking_target,
        Some(serde_json::json!({
            "profileId": profile.to_string(),
            "eventTypeId": event_type.to_string(),
        }))
    );
    let others = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM form_sections WHERE form_id = $1 AND kind <> 'booking' AND booking_target IS NOT NULL"#,
        form.id.into_uuid(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(others, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_stored_booking_target_of_the_wrong_shape_is_corrupt(pool: PgPool) {
    let table = insert_table(&pool).await;
    let repo = PgFormsRepo::new(pool.clone());
    let form = form_over(&table);
    let booking = FormSectionId::new();
    repo.create_form(
        &form,
        &FormLayout {
            sections: vec![FormSection::Booking {
                id: booking,
                title: "Book".into(),
                description: "".into(),
                target: BookingTarget {
                    profile_id: BookingProfileId::new(),
                    event_type_id: BookingEventTypeId::new(),
                },
            }],
        },
        false,
    )
    .await
    .unwrap();
    sqlx::query!(
        r#"UPDATE form_sections SET booking_target = '{"profileId": "not a uuid"}' WHERE id = $1"#,
        booking.into_uuid(),
    )
    .execute(&pool)
    .await
    .unwrap();

    let read = repo.layout(form.id).await;
    assert!(
        matches!(
            read,
            Err(PgFormsRepoError::Corrupt {
                kind: "booking target",
                ..
            })
        ),
        "{read:?}"
    );
}
