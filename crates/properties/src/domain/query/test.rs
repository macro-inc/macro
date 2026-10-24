use super::*;
use crate::domain::{
    ports::{MockNotificationService, MockPermissionService, MockPropertiesRepo},
    service_impl::PropertiesServiceImpl,
};
use chrono::{DateTime, Utc};
use models_grouping::{CandidateDirection, GroupingConfig};
use models_properties::{PropertyOwner, service::property_definition::PropertyDefinition};
use uuid::Uuid;

fn definition(id: Uuid, data_type: DataType) -> PropertyDefinition {
    PropertyDefinition {
        id,
        owner: PropertyOwner::User {
            user_id: "macro|owner@test.com".into(),
        },
        display_name: "Review date".into(),
        data_type,
        is_multi_select: false,
        specific_entity_type: None,
        created_at: DateTime::<Utc>::UNIX_EPOCH,
        updated_at: DateTime::<Utc>::UNIX_EPOCH,
        is_system: false,
        is_metadata: false,
    }
}

fn selection(id: Uuid) -> CandidateQuery {
    CandidateQuery {
        date_property_id: Some(id),
        timestamp_sort: None,
        direction: CandidateDirection::Ascending,
        grouping: None,
        cursor: None,
        limit: 10,
    }
}

#[tokio::test]
async fn private_definition_does_not_reveal_its_type() {
    let id = Uuid::from_u128(1);
    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_property_definition()
        .times(1)
        .returning(move |_| Box::pin(async move { Ok(Some(definition(id, DataType::String))) }));
    repo.expect_get_property_definition_with_owner()
        .withf(|_, user, team| user.as_ref() == "macro|stranger@test.com" && team.is_none())
        .times(1)
        .returning(|_, _, _| Box::pin(async { Ok(None) }));
    let service = PropertiesServiceImpl::<_, MockPermissionService, MockNotificationService>::new(
        repo, None, None,
    );
    let result = service
        .authorize_property_query(
            MacroUserIdStr::parse_from_str("macro|stranger@test.com").unwrap(),
            None,
            selection(id),
        )
        .await;
    assert!(matches!(result, Err(PropertiesErr::NotFound)));
}

#[tokio::test]
async fn wrong_type_and_multi_select_dates_are_rejected() {
    for (data_type, multi_select) in [(DataType::String, false), (DataType::Date, true)] {
        let id = Uuid::from_u128(1);
        let mut row = definition(id, data_type);
        row.is_multi_select = multi_select;
        let read = row.clone();
        let mut repo = MockPropertiesRepo::new();
        repo.expect_get_property_definition().returning(move |_| {
            let row = read.clone();
            Box::pin(async { Ok(Some(row)) })
        });
        repo.expect_get_property_definition_with_owner()
            .returning(move |_, _, _| {
                let row = row.clone();
                Box::pin(async { Ok(Some(row)) })
            });
        let service =
            PropertiesServiceImpl::<_, MockPermissionService, MockNotificationService>::new(
                repo, None, None,
            );
        let result = service
            .authorize_property_query(
                MacroUserIdStr::parse_from_str("macro|owner@test.com").unwrap(),
                None,
                selection(id),
            )
            .await;
        assert!(matches!(result, Err(PropertiesErr::Validation(_))));
    }
}

#[tokio::test]
async fn shared_sort_and_group_definition_is_authorized_once() {
    let id = Uuid::from_u128(1);
    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_property_definition()
        .times(1)
        .returning(move |_| Box::pin(async move { Ok(Some(definition(id, DataType::Date))) }));
    repo.expect_get_property_definition_with_owner()
        .times(1)
        .returning(move |_, _, _| {
            Box::pin(async move { Ok(Some(definition(id, DataType::Date))) })
        });
    let service = PropertiesServiceImpl::<_, MockPermissionService, MockNotificationService>::new(
        repo, None, None,
    );
    let mut query = selection(id);
    query.grouping = Some(GroupingConfig::new(GroupByField::Property {
        property_definition_id: id,
        entity_type: None,
        bucketing: None,
    }));
    let proof = service
        .authorize_property_query(
            MacroUserIdStr::parse_from_str("macro|owner@test.com").unwrap(),
            None,
            query.clone(),
        )
        .await
        .unwrap();
    query.date_property_id = Some(Uuid::from_u128(99));
    assert_eq!(proof.viewer().as_ref(), "macro|owner@test.com");
    assert_eq!(proof.query().date_property_id, Some(id));
}

#[tokio::test]
async fn private_grouping_definition_is_checked_even_without_date_buckets() {
    let sort = Uuid::from_u128(1);
    let group = Uuid::from_u128(2);
    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_property_definition()
        .times(2)
        .returning(move |id| {
            Box::pin(async move {
                Ok(Some(definition(
                    id,
                    if id == sort {
                        DataType::Date
                    } else {
                        DataType::SelectString
                    },
                )))
            })
        });
    repo.expect_get_property_definition_with_owner()
        .times(2)
        .returning(move |id, _, _| {
            Box::pin(async move { Ok((id == sort).then(|| definition(id, DataType::Date))) })
        });
    let service = PropertiesServiceImpl::<_, MockPermissionService, MockNotificationService>::new(
        repo, None, None,
    );
    let mut query = selection(sort);
    query.grouping = Some(GroupingConfig::new(GroupByField::Property {
        property_definition_id: group,
        entity_type: None,
        bucketing: None,
    }));
    let result = service
        .authorize_property_query(
            MacroUserIdStr::parse_from_str("macro|owner@test.com").unwrap(),
            None,
            query,
        )
        .await;
    assert!(matches!(result, Err(PropertiesErr::NotFound)));
}

#[tokio::test]
async fn a_team_receipt_cannot_authorize_another_viewer() {
    let repo = MockPropertiesRepo::new();
    let service = PropertiesServiceImpl::<_, MockPermissionService, MockNotificationService>::new(
        repo, None, None,
    );
    let team = TeamReceipt::dangerously_assert_authenticated_user(
        MacroUserIdStr::parse_from_str("macro|owner@test.com").unwrap(),
        &Uuid::from_u128(1).to_string(),
        entity_access::domain::models::EntityType::Team,
    );
    let result = service
        .authorize_property_query(
            MacroUserIdStr::parse_from_str("macro|stranger@test.com").unwrap(),
            Some(&team),
            selection(Uuid::from_u128(2)),
        )
        .await;
    assert!(matches!(result, Err(PropertiesErr::PermissionDenied)));
}
