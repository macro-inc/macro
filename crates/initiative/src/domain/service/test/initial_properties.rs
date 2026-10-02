use super::*;
use crate::domain::{
    models::InitialPropertyValue,
    reads::InitiativePropertySnapshot,
    resources::{InitiativeResources, ResourceFuture},
};
use entity_access::domain::models::{Entity, EntityAccessAuth};
use models_properties::api::requests::SetPropertyValue;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

type Recorded = (
    MacroUserIdStr<'static>,
    InitiativeId,
    Vec<InitialPropertyValue>,
);

/// Records the property steps a create takes, and can reject its values.
#[derive(Debug, Default)]
struct RecordingResources {
    steps: Mutex<Vec<&'static str>>,
    values: Mutex<Vec<Recorded>>,
    reject_values: bool,
}

impl InitiativeResources for RecordingResources {
    fn initialize(&self, _id: InitiativeId) -> ResourceFuture<'_, ()> {
        self.steps.lock().unwrap().push("initialize");
        Box::pin(async { Ok(()) })
    }
    fn set_initial_properties(
        &self,
        owner: MacroUserIdStr<'static>,
        id: InitiativeId,
        values: Vec<InitialPropertyValue>,
    ) -> ResourceFuture<'_, ()> {
        self.steps.lock().unwrap().push("set_initial_properties");
        self.values.lock().unwrap().push((owner, id, values));
        Box::pin(async move {
            if self.reject_values {
                Err(InitiativeError::BadRequest("option not found".into()))
            } else {
                Ok(())
            }
        })
    }
    fn purge(&self, _receipt: EntityAccessReceipt<EditAccessLevel>) -> ResourceFuture<'_, ()> {
        panic!("a create never purges through a receipt")
    }
    fn view(
        &self,
        _auth: EntityAccessAuth,
        _entity: Entity,
    ) -> ResourceFuture<'_, Option<EntityAccessReceipt<ViewAccessLevel>>> {
        panic!("a create reads no related entities")
    }
    fn properties(
        &self,
        _receipts: Vec<EntityAccessReceipt<ViewAccessLevel>>,
    ) -> ResourceFuture<'_, HashMap<String, InitiativePropertySnapshot>> {
        panic!("a create reads no property snapshots")
    }
}

fn status(option: u128) -> InitialPropertyValue {
    InitialPropertyValue {
        property_definition_id: uuid::Uuid::from_u128(0xabc),
        value: SetPropertyValue::SelectOption {
            option_id: uuid::Uuid::from_u128(option),
        },
    }
}

fn request(property_values: Vec<InitialPropertyValue>) -> CreateInitiativeRequest {
    CreateInitiativeRequest {
        name: "Launch".into(),
        property_values,
        ..Default::default()
    }
}

/// Repo and description ports for a create that reaches the property steps.
fn created_ports() -> (MockInitiativeRepo, MockInitiativeDescriptionDocuments) {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_get_team_default_link_share()
        .return_once(|_| Box::pin(async { Ok(None) }));
    repo.expect_create().return_once(|args, _, _| {
        let id = args.id;
        Box::pin(async move {
            Ok(InitiativeDetail {
                id,
                ..detail(Vec::new())
            })
        })
    });
    let mut documents = MockInitiativeDescriptionDocuments::new();
    documents
        .expect_create()
        .return_once(|_| Box::pin(async { Ok(description_document_id()) }));
    (repo, documents)
}

#[tokio::test]
async fn create_sets_initial_values_as_the_owner_once_properties_are_attached() {
    let (repo, documents) = created_ports();
    let resources = Arc::new(RecordingResources::default());
    let created = InitiativeServiceImpl::new(
        repo,
        documents,
        MockInitiativeDescriptionSurfaces::new(),
        resources.clone(),
    )
    .create(&user(OWNER), request(vec![status(1)]))
    .await
    .expect("created");

    assert_eq!(
        *resources.steps.lock().unwrap(),
        ["initialize", "set_initial_properties"]
    );
    assert_eq!(
        *resources.values.lock().unwrap(),
        [(user(OWNER), created.id, vec![status(1)])]
    );
}

#[tokio::test]
async fn rejected_initial_values_delete_the_new_project_and_its_description() {
    let (mut repo, mut documents) = created_ports();
    repo.expect_delete()
        .times(1)
        .return_once(|_| Box::pin(async { Ok(description()) }));
    documents
        .expect_purge()
        .withf(|id| *id == description_document_id())
        .times(1)
        .return_once(|_| Box::pin(async { Ok(()) }));
    let events = Arc::new(super::events::Events::default());
    let svc = InitiativeServiceImpl::new(
        repo,
        documents,
        // The surface is adopted on first open, so a failed create has none to remove.
        MockInitiativeDescriptionSurfaces::new(),
        Arc::new(RecordingResources {
            reject_values: true,
            ..Default::default()
        }),
    )
    .with_event_publisher(events.clone());

    let result = svc.create(&user(OWNER), request(vec![status(1)])).await;

    assert!(matches!(result, Err(InitiativeError::BadRequest(_))));
    // Consumers learn the project is gone; it is never announced as created.
    assert!(matches!(
        events.0.lock().unwrap().as_slice(),
        [crate::domain::events::InitiativeTopicEvent::Purged { .. }]
    ));
}

#[tokio::test]
async fn invalid_initial_values_are_rejected_before_anything_is_created() {
    // No expectations: any repo, document, or property call fails the test.
    let svc = InitiativeServiceImpl::new(
        MockInitiativeRepo::new(),
        MockInitiativeDescriptionDocuments::new(),
        MockInitiativeDescriptionSurfaces::new(),
        Arc::new(RecordingResources::default()),
    );

    let duplicate = svc
        .create(&user(OWNER), request(vec![status(1), status(2)]))
        .await;
    assert!(matches!(duplicate, Err(InitiativeError::BadRequest(_))));

    let excessive = svc
        .create(
            &user(OWNER),
            request(
                (0..=32)
                    .map(|index| InitialPropertyValue {
                        property_definition_id: uuid::Uuid::from_u128(index),
                        ..status(1)
                    })
                    .collect(),
            ),
        )
        .await;
    assert!(matches!(excessive, Err(InitiativeError::BadRequest(_))));
}
