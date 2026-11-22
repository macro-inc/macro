use super::*;
use models_properties::{EntityReference, EntityType};

fn configuration(entity_id: &str) -> TaskTemplateConfiguration {
    let property_id = Uuid::from_u128(1);
    TaskTemplateConfiguration {
        title: None,
        share_with_team: None,
        property_ids: vec![property_id],
        defaults: vec![PropertyDefault {
            property_id,
            value: SetPropertyValue::MultiEntityReference {
                references: vec![EntityReference::new(entity_id, EntityType::User)],
            },
        }],
        description_markdown: String::new(),
    }
}

/// A template whose defaults name an agent would put it to work for whoever
/// uses it, so a scoped request may not save one; a person's own may.
#[test]
fn a_default_naming_an_agent_assigns_one() {
    assert!(configuration("bot|00000000-0000-0000-0000-00000000b07a").assigns_an_agent());
    assert!(!configuration("macro|owner@example.com").assigns_an_agent());
}
