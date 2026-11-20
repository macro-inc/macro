use super::*;

#[test]
fn scheduled_action_round_trips_through_graphql_entity_type() {
    let graphql = GraphqlEntityType::new(EntityType::ScheduledAction);
    assert!(matches!(graphql, GraphqlEntityType::ScheduledAction));
    assert!(matches!(
        graphql.into_model().ok(),
        Some(EntityType::ScheduledAction)
    ));
}

#[test]
fn scheduled_action_is_not_a_soup_entity_type() {
    assert!(GraphqlSoupEntityType::try_new(EntityType::ScheduledAction).is_none());
}

#[test]
fn initiative_round_trips_through_graphql_entity_type() {
    let graphql = GraphqlEntityType::new(EntityType::Initiative);
    assert!(matches!(graphql, GraphqlEntityType::Initiative));
    assert!(matches!(
        graphql.into_model().ok(),
        Some(EntityType::Initiative)
    ));
}

#[test]
fn initiative_round_trips_through_soup_entity_type() {
    let graphql = GraphqlSoupEntityType::try_new(EntityType::Initiative).unwrap();
    assert!(matches!(graphql, GraphqlSoupEntityType::Initiative));
    assert_eq!(graphql.into_model().ok(), Some(EntityType::Initiative));
}

#[test]
fn database_row_round_trips_through_graphql_entity_type() {
    let graphql = GraphqlEntityType::new(EntityType::DatabaseRow);
    assert!(matches!(graphql, GraphqlEntityType::DatabaseRow));
    assert!(matches!(
        graphql.into_model().ok(),
        Some(EntityType::DatabaseRow)
    ));
}

#[test]
fn database_row_round_trips_through_soup_entity_type() {
    let graphql = GraphqlSoupEntityType::try_new(EntityType::DatabaseRow).unwrap();
    assert!(matches!(graphql, GraphqlSoupEntityType::DatabaseRow));
    assert_eq!(graphql.into_model().ok(), Some(EntityType::DatabaseRow));
}

#[test]
fn form_round_trips_through_graphql_entity_type() {
    let graphql = GraphqlEntityType::new(EntityType::Form);
    assert!(matches!(graphql, GraphqlEntityType::Form));
    assert!(matches!(graphql.into_model().ok(), Some(EntityType::Form)));
}

#[test]
fn whatsapp_group_stub_is_rejected_as_input() {
    assert!(GraphqlEntityType::WhatsappGroup.into_model().is_err());
}

#[test]
fn outside_soup_is_rejected_as_input() {
    assert!(GraphqlSoupEntityType::OutsideSoup.into_model().is_err());
}

#[test]
fn form_is_not_a_soup_entity_type() {
    assert!(GraphqlSoupEntityType::try_new(EntityType::Form).is_none());
}
