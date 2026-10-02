use super::*;

#[test]
fn a_row_projects_its_table_and_nothing_a_row_cannot_have() {
    let row = uuid::Uuid::from_u128(0x70000000_0000_0000_0000_000000000001);
    let deals = uuid::Uuid::from_u128(0x7ab00000_0000_0000_0000_000000000001);
    let document = project_database_row(DatabaseRowProjectionInput {
        record_key: RecordKey::new(format!("GraphqlSoupDatabaseRow:{row}")).unwrap(),
        id: row,
        owner: "macro|owner@databases.test".into(),
        table_id: deals,
        created_at: "2026-01-01T00:00:00Z".parse().unwrap(),
        updated_at: "2026-01-02T00:00:00Z".parse().unwrap(),
    })
    .unwrap();

    let mut expected = IndexDocument {
        record_key: RecordKey::new(format!("GraphqlSoupDatabaseRow:{row}")).unwrap(),
        profile: vocabulary::profile_v4(),
        partition: vocabulary::database_row_partition(),
        exact_facts: vec![
            ExactFact {
                attribute: vocabulary::id(),
                value: ExactValue::new(row.as_bytes()).unwrap(),
            },
            ExactFact {
                attribute: vocabulary::owner(),
                value: ExactValue::utf8("macro|owner@databases.test").unwrap(),
            },
            ExactFact {
                attribute: vocabulary::table_id(),
                value: ExactValue::new(deals.as_bytes()).unwrap(),
            },
        ],
        integer_facts: vec![
            IntegerFact {
                attribute: vocabulary::created_at(),
                value: 1_767_225_600_000_000,
            },
            IntegerFact {
                attribute: vocabulary::updated_at(),
                value: 1_767_312_000_000_000,
            },
        ],
        sort_facts: vec![
            IntegerFact {
                attribute: vocabulary::created_at(),
                value: 1_767_225_600_000_000,
            },
            IntegerFact {
                attribute: vocabulary::updated_at(),
                value: 1_767_312_000_000_000,
            },
        ],
    };
    expected.canonicalize();
    assert_eq!(document, expected);

    let mut without_table = document.clone();
    without_table
        .exact_facts
        .retain(|fact| fact.attribute != vocabulary::table_id());
    assert_eq!(
        validate_soup_flat_v4(&without_table),
        Err(ProfileValidationError::MissingRequired("table-id"))
    );
    let mut with_project = document.clone();
    with_project.exact_facts.push(ExactFact {
        attribute: vocabulary::project_id(),
        value: ExactValue::new(deals.as_bytes()).unwrap(),
    });
    assert!(validate_soup_flat_v4(&with_project).is_err());
    let mut older = document;
    older.profile = vocabulary::profile_v3();
    assert_eq!(
        validate_soup_flat_v3(&older),
        Err(ProfileValidationError::UnsupportedPartition(
            "database_row".into()
        ))
    );
}
