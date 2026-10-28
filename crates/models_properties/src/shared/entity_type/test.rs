use std::str::FromStr;

use super::*;
use crate::api::PropertyTargetEntityType;

#[test]
fn initiative_storage_and_target_spelling_is_distinct_from_folder_projects() {
    assert_eq!(
        serde_json::to_string(&EntityType::Initiative).unwrap(),
        "\"INITIATIVE\""
    );
    assert_eq!(
        serde_json::to_string(&PropertyTargetEntityType::Initiative).unwrap(),
        "\"INITIATIVE\""
    );
    assert_eq!(
        EntityType::from_str("INITIATIVE").unwrap(),
        EntityType::Initiative
    );
    assert_eq!(EntityType::Initiative.to_string(), "initiative");
    assert_eq!(
        EntityType::from_str("project").unwrap(),
        EntityType::Project
    );
    assert_ne!(EntityType::Initiative, EntityType::Project);
}

#[test]
fn database_row_spells_as_the_database_row_enum_label() {
    assert_eq!(
        serde_json::to_string(&EntityType::DatabaseRow).unwrap(),
        "\"DATABASE_ROW\""
    );
    assert_eq!(
        serde_json::to_string(&PropertyTargetEntityType::DatabaseRow).unwrap(),
        "\"DATABASE_ROW\""
    );
    assert_eq!(EntityType::DatabaseRow.to_string(), "database_row");
    assert_eq!(
        EntityType::from_str("DATABASE_ROW").unwrap(),
        EntityType::DatabaseRow
    );
    assert_eq!(
        EntityType::from_str("database_row").unwrap(),
        EntityType::DatabaseRow
    );
}

#[test]
fn crm_contact_round_trips_through_storage_and_display_spellings() {
    assert_eq!(
        serde_json::to_string(&EntityType::Contact).unwrap(),
        "\"CONTACT\""
    );
    assert_eq!(
        EntityType::from_str("CONTACT").unwrap(),
        EntityType::Contact
    );
    assert_eq!(EntityType::Contact.to_string(), "contact");
}
