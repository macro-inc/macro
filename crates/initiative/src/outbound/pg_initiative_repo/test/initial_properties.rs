//! Initial property values through the real properties, system-properties and
//! access services, the way the document storage service composes them.

use super::*;
use crate::domain::{
    models::{CreateInitiativeRequest, InitialPropertyValue, InitiativeError},
    ports::{
        InitiativeService, MockInitiativeDescriptionDocuments, MockInitiativeDescriptionSurfaces,
    },
    resources::InitiativeResources,
    service::InitiativeServiceImpl,
};
use crate::outbound::resources::ProjectResources;
use entity_access::{
    domain::{
        models::{EntityAccessReceipt, EntityType, ViewAccessLevel},
        ports::EntityAccessService,
        service::EntityAccessServiceImpl,
    },
    outbound::PgAccessRepository,
};
use models_properties::{api::requests::SetPropertyValue, service::property_value::PropertyValue};
use properties::{
    PermissionServiceImpl, PropertiesPgRepo, PropertiesService, PropertiesServiceImpl,
    domain::model::TaskAssignedNotification,
};
use std::sync::Arc;
use system_properties::{
    PgSystemPropertiesRepository, StatusOption, SystemPropertiesServiceImpl, SystemPropertyKey,
};

/// Initial values do not assign anyone here, so nothing is ever notified.
struct NoNotifications;

impl properties::NotificationService for NoNotifications {
    type Err = anyhow::Error;

    async fn send_task_assigned<'a>(&self, _: TaskAssignedNotification<'a>) -> anyhow::Result<()> {
        Ok(())
    }
}

type Access = EntityAccessServiceImpl<PgAccessRepository>;
type Properties =
    PropertiesServiceImpl<PropertiesPgRepo, PermissionServiceImpl<Access>, NoNotifications>;

struct Harness {
    access: Arc<Access>,
    properties: Arc<Properties>,
    resources: Arc<
        ProjectResources<
            Properties,
            SystemPropertiesServiceImpl<PgSystemPropertiesRepository>,
            Access,
        >,
    >,
}

fn harness(pool: &PgPool) -> Harness {
    let access = Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
        pool.clone(),
    )));
    let properties = Arc::new(PropertiesServiceImpl::new(
        PropertiesPgRepo::new(pool.clone()),
        Some(PermissionServiceImpl::new(pool.clone(), access.clone())),
        Some(NoNotifications),
    ));
    let resources = Arc::new(ProjectResources::new(
        properties.clone(),
        Arc::new(SystemPropertiesServiceImpl::new(
            PgSystemPropertiesRepository::new(pool.clone()),
        )),
        access.clone(),
    ));
    Harness {
        access,
        properties,
        resources,
    }
}

fn status(option_id: Uuid) -> InitialPropertyValue {
    InitialPropertyValue {
        property_definition_id: SystemPropertyKey::STATUS_UUID,
        value: SetPropertyValue::SelectOption { option_id },
    }
}

async fn status_of(harness: &Harness, id: InitiativeId) -> anyhow::Result<Option<PropertyValue>> {
    let receipt: EntityAccessReceipt<ViewAccessLevel> = harness
        .access
        .generate_entity_access_receipt(&user(OWNER), None, &id.to_string(), EntityType::Initiative)
        .await?;
    Ok(harness
        .properties
        .get_property_value(&receipt, SystemPropertyKey::STATUS_UUID)
        .await?)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_persists_initial_values_in_the_same_request(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let description = seed_description_document(&pool, OWNER).await?;
    let mut documents = MockInitiativeDescriptionDocuments::new();
    documents
        .expect_create()
        .return_once(move |_| Box::pin(async move { Ok(description) }));
    let harness = harness(&pool);
    let service = InitiativeServiceImpl::new(
        repo(pool.clone()),
        documents,
        MockInitiativeDescriptionSurfaces::new(),
        harness.resources.clone(),
    );

    let created = service
        .create(
            &user(OWNER),
            CreateInitiativeRequest {
                name: "Launch".into(),
                share_with_team: Some(false),
                property_values: vec![status(StatusOption::IN_PROGRESS_UUID)],
                ..Default::default()
            },
        )
        .await?;

    assert_eq!(
        status_of(&harness, created.id).await?,
        Some(PropertyValue::SelectOption(vec![
            StatusOption::IN_PROGRESS_UUID
        ]))
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_rejected_value_leaves_no_initial_values_behind(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER).await?;
    let project = repo(pool.clone())
        .create(
            create_args(&pool, OWNER, "Launch", &[]).await?,
            share_off(),
            TeamShareCreation::Unshared,
        )
        .await?;
    let harness = harness(&pool);
    harness.resources.initialize(project.id).await?;

    // The first value is valid and written before the second is rejected.
    let result = harness
        .resources
        .set_initial_properties(
            user(OWNER),
            project.id,
            vec![
                status(StatusOption::IN_PROGRESS_UUID),
                InitialPropertyValue {
                    property_definition_id: SystemPropertyKey::PRIORITY_UUID,
                    value: SetPropertyValue::SelectOption {
                        option_id: Uuid::now_v7(),
                    },
                },
            ],
        )
        .await;

    assert!(matches!(result, Err(InitiativeError::BadRequest(_))));
    assert_eq!(status_of(&harness, project.id).await?, None);
    Ok(())
}
