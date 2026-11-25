use models_databases::EntityKind;
use serde_json::json;
use uuid::Uuid;

use super::{names_any, retargeted};

#[test]
fn a_cell_names_the_survivor_once_and_keeps_other_references() {
    let [survivor, first, second, contact] = [1u128, 2, 3, 4].map(Uuid::from_u128);
    let values = json!({"type": "EntityReference", "value": [
        {"entity_type": "COMPANY", "entity_id": first.to_string()},
        {"entity_type": "CONTACT", "entity_id": first.to_string()},
        {"entity_type": "COMPANY", "entity_id": survivor.to_string()},
        {"entity_type": "COMPANY", "entity_id": second.to_string()},
    ]});
    assert!(names_any(&values, EntityKind::Company, &[second]));
    assert!(!names_any(&values, EntityKind::Company, &[contact]));

    let refs = retargeted(&values, EntityKind::Company, &[first, second], survivor);
    let named: Vec<(EntityKind, String)> = refs
        .into_iter()
        .map(|reference| (reference.entity_type, reference.entity_id))
        .collect();
    assert_eq!(
        named,
        vec![
            (EntityKind::Company, survivor.to_string()),
            (EntityKind::Contact, first.to_string()),
        ]
    );
}
