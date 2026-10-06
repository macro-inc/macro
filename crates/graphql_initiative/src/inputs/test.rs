use async_graphql::ID;
use graphql_properties::GraphqlSetPropertyValue;
use initiative::domain::models::{CreateInitiativeRequest, InitialPropertyValue};
use models_properties::api::requests::SetPropertyValue;
use uuid::Uuid;

use super::{CreateInitiativeInput, InitialPropertyValueInput};

fn input(property_values: Vec<InitialPropertyValueInput>) -> CreateInitiativeInput {
    CreateInitiativeInput {
        name: "Launch".into(),
        description: None,
        member_ids: None,
        share_with_team: Some(false),
        property_values: Some(property_values),
    }
}

#[test]
fn initial_values_convert_to_the_domain_request() {
    let status = Uuid::from_u128(1);
    let in_progress = Uuid::from_u128(2);
    let due = Uuid::from_u128(3);
    let request = CreateInitiativeRequest::try_from(input(vec![
        InitialPropertyValueInput {
            property_definition_id: ID(status.to_string()),
            value: GraphqlSetPropertyValue::SelectOption(ID(in_progress.to_string())),
        },
        InitialPropertyValueInput {
            property_definition_id: ID(due.to_string()),
            value: GraphqlSetPropertyValue::Date("2026-10-01T00:00:00Z".into()),
        },
    ]))
    .expect("valid input");

    assert_eq!(request.share_with_team, Some(false));
    assert_eq!(
        request.property_values,
        vec![
            InitialPropertyValue {
                property_definition_id: status,
                value: SetPropertyValue::SelectOption {
                    option_id: in_progress,
                },
            },
            InitialPropertyValue {
                property_definition_id: due,
                value: SetPropertyValue::Date {
                    value: "2026-10-01T00:00:00Z".parse().unwrap(),
                },
            },
        ]
    );
}

#[test]
fn malformed_initial_values_fail_before_the_service_is_called() {
    for value in [
        InitialPropertyValueInput {
            property_definition_id: ID("not-a-uuid".into()),
            value: GraphqlSetPropertyValue::Boolean(true),
        },
        InitialPropertyValueInput {
            property_definition_id: ID(Uuid::from_u128(1).to_string()),
            value: GraphqlSetPropertyValue::Date("yesterday".into()),
        },
    ] {
        assert!(CreateInitiativeRequest::try_from(input(vec![value])).is_err());
    }
}
