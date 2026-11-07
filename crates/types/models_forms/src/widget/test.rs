use models_databases::{DatabaseId, EntityKind, TableId};
use uuid::Uuid;

use super::*;

#[test]
fn each_column_kind_takes_the_widgets_of_rfc_01_section_4() {
    assert_eq!(
        Widget::choices(ColumnKind::Text),
        &[Widget::Short, Widget::Paragraph]
    );
    assert_eq!(Widget::choices(ColumnKind::Number), &[] as &[Widget]);
    assert_eq!(Widget::choices(ColumnKind::Boolean), &[] as &[Widget]);
    assert_eq!(
        Widget::choices(ColumnKind::Date),
        &[Widget::Datetime, Widget::Date]
    );
    assert_eq!(
        Widget::choices(ColumnKind::Link),
        &[Widget::Url, Widget::File]
    );
    assert_eq!(
        Widget::choices(ColumnKind::Select { multi: false }),
        &[Widget::Choice, Widget::Dropdown]
    );
    assert_eq!(
        Widget::choices(ColumnKind::Select { multi: true }),
        &[Widget::Checkboxes]
    );
    assert_eq!(
        Widget::choices(ColumnKind::SelectNumber { multi: false }),
        &[Widget::Dropdown]
    );
    assert_eq!(Widget::choices(ColumnKind::Tag), &[Widget::Checkboxes]);
    assert_eq!(
        Widget::choices(ColumnKind::Entity {
            target: EntityKind::User,
            multi: false
        }),
        &[] as &[Widget]
    );
    assert_eq!(
        Widget::choices(ColumnKind::Relation {
            database: DatabaseId::from_uuid(Uuid::from_u128(1)),
            table: TableId::from_uuid(Uuid::from_u128(2)),
        }),
        &[] as &[Widget]
    );
}

#[test]
fn the_first_choice_is_the_default_and_others_do_not_fit() {
    assert_eq!(Widget::default_for(ColumnKind::Text), Some(Widget::Short));
    assert_eq!(Widget::default_for(ColumnKind::Number), None);
    assert!(Widget::Paragraph.fits(ColumnKind::Text));
    assert!(!Widget::Paragraph.fits(ColumnKind::Date));
    assert!(!Widget::Choice.fits(ColumnKind::Select { multi: true }));
}

#[test]
fn a_widget_is_stored_and_sent_by_its_lowercase_name() {
    assert_eq!(Widget::Datetime.name(), "datetime");
    assert_eq!("checkboxes".parse::<Widget>().unwrap(), Widget::Checkboxes);
    assert_eq!(
        serde_json::to_value(Widget::Dropdown).unwrap(),
        serde_json::json!("dropdown")
    );
}
