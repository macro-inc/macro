use super::*;

#[test]
fn a_tag_holds_several_labels_whatever_its_stored_flag() {
    assert_eq!(
        stored_cast_kind(DataType::Tag, false, None, false),
        CastKind::Select { multi: true }
    );
    assert_eq!(
        stored_cast_kind(DataType::Tag, true, None, false),
        CastKind::Select { multi: true }
    );
}

#[test]
fn stored_types_read_as_the_kinds_the_cast_rule_takes() {
    assert_eq!(
        stored_cast_kind(DataType::String, false, None, false),
        CastKind::Text
    );
    assert_eq!(
        stored_cast_kind(DataType::Link, false, None, false),
        CastKind::Link
    );
    assert_eq!(
        stored_cast_kind(DataType::SelectNumber, true, None, false),
        CastKind::Select { multi: true }
    );
    assert_eq!(
        stored_cast_kind(DataType::SelectString, false, None, false),
        CastKind::Select { multi: false }
    );
    assert_eq!(
        stored_cast_kind(DataType::Entity, false, None, false),
        CastKind::Entity {
            target: EntityKind::User,
            multi: false
        }
    );
    assert_eq!(
        stored_cast_kind(DataType::Entity, true, Some(EntityKind::Task), false),
        CastKind::Entity {
            target: EntityKind::Task,
            multi: true
        }
    );
    assert_eq!(
        stored_cast_kind(DataType::Entity, true, None, true),
        CastKind::Relation
    );
}

#[test]
fn a_numeric_option_is_labeled_without_a_trailing_fraction() {
    assert_eq!(OptionValue::Number(2.0).label(), "2");
    assert_eq!(OptionValue::Number(2.5).label(), "2.5");
    assert_eq!(OptionValue::String("Going".into()).label(), "Going");
}
