use super::*;
use macro_user_id::cowlike::CowLike;
use models_properties::{EntityType, shared::entity_reference::EntityReference};

fn viewer() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|me@example.com")
        .unwrap()
        .into_owned()
}

fn field(kind: FieldKind) -> PipelineField {
    PipelineField {
        id: ColumnId::new(),
        name: "Field".into(),
        kind,
        multiple: false,
        options: Vec::new(),
        required: false,
        writable: true,
    }
}

fn stage() -> (PipelineField, OptionId, OptionId) {
    let (lead, won) = (OptionId::new(), OptionId::new());
    let field = PipelineField {
        name: "Stage".into(),
        options: vec![(lead, "Lead".into()), (won, "Won".into())],
        ..field(FieldKind::Select)
    };
    (field, lead, won)
}

fn one(value: &str) -> FieldInput {
    FieldInput::One(value.into())
}

#[test]
fn stage_labels_resolve_to_options_ignoring_case() {
    let (stage, _, won) = stage();
    assert_eq!(
        cell_value(&stage, &one("won"), &viewer()),
        Ok(CellValue::Options(vec![OptionRef::Id(won)]))
    );
    let error = cell_value(&stage, &one("Closed"), &viewer()).unwrap_err();
    assert!(error.contains("Lead, Won"), "{error}");
}

#[test]
fn a_single_valued_field_refuses_several_values() {
    let (stage, _, _) = stage();
    let several = FieldInput::Many(vec!["Lead".into(), "Won".into()]);
    assert!(cell_value(&stage, &several, &viewer()).is_err());
    let tags = PipelineField {
        multiple: true,
        ..stage
    };
    assert!(matches!(
        cell_value(&tags, &several, &viewer()),
        Ok(CellValue::Options(options)) if options.len() == 2
    ));
}

#[test]
fn people_are_me_an_email_or_a_user_id() {
    let owner = field(FieldKind::Person);
    for (input, id) in [
        ("me", "macro|me@example.com"),
        ("Sam@Example.com", "macro|sam@example.com"),
        ("macro|sam@example.com", "macro|sam@example.com"),
    ] {
        assert_eq!(
            cell_value(&owner, &one(input), &viewer()),
            Ok(CellValue::Entities(vec![EntityRef {
                entity_type: EntityKind::User,
                entity_id: id.into(),
            }]))
        );
    }
    assert!(cell_value(&owner, &one("Sam"), &viewer()).is_err());
}

#[test]
fn numbers_dates_and_checkboxes_parse_from_text() {
    assert_eq!(
        cell_value(&field(FieldKind::Number), &one("$48,000.50"), &viewer()),
        Ok(CellValue::Number(48_000.5))
    );
    assert!(cell_value(&field(FieldKind::Number), &one("lots"), &viewer()).is_err());
    assert_eq!(
        cell_value(&field(FieldKind::Date), &one("2026-10-12"), &viewer()),
        Ok(CellValue::Date(
            DateTime::parse_from_rfc3339("2026-10-12T00:00:00Z")
                .unwrap()
                .with_timezone(&Utc)
        ))
    );
    assert_eq!(
        cell_value(&field(FieldKind::Checkbox), &one("Yes"), &viewer()),
        Ok(CellValue::Boolean(true))
    );
}

#[test]
fn clearing_empties_the_cell_but_record_and_computed_fields_refuse_writes() {
    assert_eq!(
        cell_value(&field(FieldKind::Text), &FieldInput::Clear, &viewer()),
        Ok(CellValue::Clear)
    );
    for kind in [
        FieldKind::Record(PipelineRecordType::Company),
        FieldKind::Formula,
        FieldKind::Relation,
    ] {
        assert!(cell_value(&field(kind), &one("x"), &viewer()).is_err());
    }
    let read_only = PipelineField {
        writable: false,
        ..field(FieldKind::Text)
    };
    assert!(cell_value(&read_only, &one("x"), &viewer()).is_err());
}

#[test]
fn stored_cells_read_back_as_labels_and_ids() {
    let (stage, lead, _) = stage();
    assert_eq!(
        field_value(&stage, &PropertyValue::SelectOption(vec![lead.into_uuid()])),
        Some(FieldValue::Labels(vec!["Lead".into()]))
    );
    assert_eq!(
        field_value(&stage, &PropertyValue::SelectOption(Vec::new())),
        None
    );
    let owner = PropertyValue::EntityRef(vec![EntityReference::new(
        "macro|sam@example.com",
        EntityType::User,
    )]);
    assert_eq!(
        field_value(&field(FieldKind::Person), &owner),
        Some(FieldValue::References(vec!["macro|sam@example.com".into()]))
    );
}

#[test]
fn filters_match_any_wanted_value_and_empty_cells() {
    let (stage, lead, _) = stage();
    let cell = PropertyValue::SelectOption(vec![lead.into_uuid()]);
    let either = FieldInput::Many(vec!["won".into(), "lead".into()]);
    assert_eq!(matches(&stage, Some(&cell), &either, &viewer()), Ok(true));
    assert_eq!(
        matches(&stage, Some(&cell), &one("Won"), &viewer()),
        Ok(false)
    );
    assert_eq!(
        matches(&stage, None, &FieldInput::Clear, &viewer()),
        Ok(true)
    );
    assert!(matches(&stage, None, &one("Closed"), &viewer()).is_err());

    let owner = PropertyValue::EntityRef(vec![EntityReference::new(
        "macro|me@example.com",
        EntityType::User,
    )]);
    assert_eq!(
        matches(
            &field(FieldKind::Person),
            Some(&owner),
            &one("me"),
            &viewer()
        ),
        Ok(true)
    );
    let notes = PropertyValue::Str("Call back next week".into());
    assert_eq!(
        matches(
            &field(FieldKind::Text),
            Some(&notes),
            &one("NEXT week"),
            &viewer()
        ),
        Ok(true)
    );
}

#[test]
fn stages_sort_in_pipeline_order_with_empty_cells_last() {
    let (stage, _, _) = stage();
    let lead = FieldValue::Labels(vec!["Lead".into()]);
    let won = FieldValue::Labels(vec!["Won".into()]);
    assert_eq!(
        compare(&stage, Some(&lead), Some(&won), false),
        Ordering::Less
    );
    assert_eq!(
        compare(&stage, Some(&lead), Some(&won), true),
        Ordering::Greater
    );
    assert_eq!(compare(&stage, None, Some(&lead), true), Ordering::Greater);
}
