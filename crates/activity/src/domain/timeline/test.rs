use super::*;
use crate::domain::models::{NameChange, PropertyChange};

const STATUS: Uuid = Uuid::from_u128(0xab);
const ASSIGNEE: Uuid = Uuid::from_u128(2);

fn property_changed(property: &str) -> Action {
    Action::PropertyChanged(PropertyChange {
        property: property.to_owned(),
        from: None,
        to: Some(serde_json::json!("Done")),
    })
}

#[test]
fn selection_includes_only_its_actions() {
    let selection = TimelineSelection::new(&[ActionTag::Renamed, ActionTag::PictureChanged], &[]);
    assert!(selection.includes(&Action::PictureChanged));
    assert!(selection.includes(&Action::Renamed(NameChange {
        from: None,
        to: Some("New".into()),
    })));
    assert!(!selection.includes(&Action::Edited));
    assert!(!selection.includes(&property_changed(&STATUS.to_string())));
    assert_eq!(selection.action_tags(), ["renamed", "picture_changed"]);
}

#[test]
fn properties_narrow_property_changes_only() {
    let selection = TimelineSelection::new(
        &[ActionTag::PropertyChanged, ActionTag::Created],
        &[STATUS, ASSIGNEE],
    );
    assert!(selection.includes(&property_changed(&STATUS.to_string())));
    assert!(selection.includes(&property_changed(&ASSIGNEE.to_string())));
    assert!(!selection.includes(&property_changed(&Uuid::from_u128(3).to_string())));
    assert!(!selection.includes(&property_changed("not-a-uuid")));
    // Storage compares text, so a differently formatted id matches neither.
    assert!(!selection.includes(&property_changed(&STATUS.to_string().to_uppercase())));
    assert!(selection.includes(&Action::Created));
    assert_eq!(
        selection.property_ids(),
        [STATUS.to_string(), ASSIGNEE.to_string()]
    );

    let every_property =
        TimelineSelection::new(&[ActionTag::PropertyChanged, ActionTag::Created], &[]);
    assert!(every_property.includes(&property_changed("any-property")));
}

#[test]
#[should_panic(expected = "timelines cannot show")]
fn selections_cannot_name_actions_the_index_skips() {
    TimelineSelection::new(&[ActionTag::Renamed, ActionTag::Edited], &[]);
}
