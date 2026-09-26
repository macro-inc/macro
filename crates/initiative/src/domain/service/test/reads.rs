use super::*;
use crate::domain::{
    reads::*,
    resources::{InitiativeResources, ResourceFuture},
};
use entity_access::domain::models::{Entity, EntityAccessAuth};
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

#[derive(Debug, Default)]
pub(super) struct FakeResources {
    denied: HashSet<String>,
    values: HashMap<String, InitiativePropertySnapshot>,
    fail_initialization: bool,
}

impl InitiativeResources for FakeResources {
    fn initialize(&self, _id: InitiativeId) -> ResourceFuture<'_, ()> {
        Box::pin(async {
            if self.fail_initialization {
                Err(InitiativeError::Internal(rootcause::report!(
                    "initialization failed"
                )))
            } else {
                Ok(())
            }
        })
    }
    fn purge(&self, _receipt: EntityAccessReceipt<EditAccessLevel>) -> ResourceFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
    fn view(
        &self,
        auth: EntityAccessAuth,
        entity: Entity,
    ) -> ResourceFuture<'_, Option<EntityAccessReceipt<ViewAccessLevel>>> {
        Box::pin(async move {
            if self.denied.contains(&entity.entity_id) {
                return Ok(None);
            }
            Ok(Some(
                EntityAccessReceipt::try_new(
                    auth,
                    entity,
                    EntityPermission::AccessLevel {
                        access_level: AccessLevel::Owner,
                    },
                )
                .unwrap(),
            ))
        })
    }
    fn properties(
        &self,
        _receipts: Vec<EntityAccessReceipt<ViewAccessLevel>>,
    ) -> ResourceFuture<'_, HashMap<String, InitiativePropertySnapshot>> {
        Box::pin(async { Ok(self.values.clone()) })
    }
}

fn service_with_resources(
    repo: MockInitiativeRepo,
    resources: FakeResources,
) -> InitiativeServiceImpl<MockInitiativeRepo, MockInitiativeDescriptionDocuments> {
    InitiativeServiceImpl::new(
        repo,
        MockInitiativeDescriptionDocuments::new(),
        Arc::new(resources),
    )
}

fn summary(id: u128, name: &str) -> InitiativeSummary {
    InitiativeSummary {
        id: InitiativeId::from_uuid(uuid::Uuid::from_u128(id)),
        name: name.into(),
        description_document_id: description_document_id(),
        updated_at: now(),
    }
}

#[tokio::test]
async fn single_summary_counts_only_visible_tasks_and_uses_canonical_properties() {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_get_detail().times(1).return_once(|_| {
        Box::pin(async {
            let mut d = detail(Vec::new());
            d.task_ids = vec!["open".into(), "done".into(), "hidden".into()];
            Ok(Some(d))
        })
    });
    let status = uuid::Uuid::from_u128(50);
    let project_id = detail(Vec::new()).id.to_string();
    let svc = service_with_resources(
        repo,
        FakeResources {
            denied: HashSet::from(["hidden".into()]),
            values: HashMap::from([
                (
                    project_id,
                    InitiativePropertySnapshot {
                        status: Some(status),
                        ..Default::default()
                    },
                ),
                (
                    "done".into(),
                    InitiativePropertySnapshot {
                        completed: true,
                        ..Default::default()
                    },
                ),
                (
                    "hidden".into(),
                    InitiativePropertySnapshot {
                        completed: true,
                        ..Default::default()
                    },
                ),
            ]),
            ..Default::default()
        },
    );
    let summary = svc.summary(view_receipt()).await.unwrap();
    assert_eq!(summary.task_count, 2);
    assert_eq!(summary.completed_task_count, 1);
    assert_eq!(summary.properties.status, Some(status));
}

#[tokio::test]
async fn failed_property_initialization_compensates_project_and_description() {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_get_team_default_link_share()
        .return_once(|_| Box::pin(async { Ok(None) }));
    repo.expect_create()
        .return_once(|_, _, _| Box::pin(async { Ok(detail(Vec::new())) }));
    repo.expect_delete()
        .times(1)
        .return_once(|_| Box::pin(async { Ok(description_document_id()) }));
    let mut documents = MockInitiativeDescriptionDocuments::new();
    documents
        .expect_create()
        .return_once(|_| Box::pin(async { Ok(description_document_id()) }));
    documents
        .expect_purge()
        .withf(|id| *id == description_document_id())
        .times(1)
        .return_once(|_| Box::pin(async { Ok(()) }));
    let svc = InitiativeServiceImpl::new(
        repo,
        documents,
        Arc::new(FakeResources {
            fail_initialization: true,
            ..Default::default()
        }),
    );
    assert!(matches!(
        svc.create(
            &user(OWNER),
            CreateInitiativeRequest {
                name: "Launch".into(),
                ..Default::default()
            }
        )
        .await,
        Err(InitiativeError::Internal(_))
    ));
}

#[tokio::test]
async fn task_paging_filters_visibility_before_counting_and_page_boundaries() {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_get_detail().times(2).returning(|_| {
        Box::pin(async {
            let mut d = detail(Vec::new());
            d.task_ids = vec!["z".into(), "hidden".into(), "a".into()];
            Ok(Some(d))
        })
    });
    let svc = service_with_resources(
        repo,
        FakeResources {
            denied: HashSet::from(["hidden".into()]),
            ..Default::default()
        },
    );
    let first = svc
        .tasks_page(
            view_receipt(),
            InitiativeTasksRequest {
                limit: Some(1),
                cursor: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(first.task_ids, ["a"]);
    assert_eq!(first.total, 2);
    assert_eq!(first.next_cursor.as_deref(), Some("a"));
    let last = svc
        .tasks_page(
            view_receipt(),
            InitiativeTasksRequest {
                limit: Some(1),
                cursor: first.next_cursor,
            },
        )
        .await
        .unwrap();
    assert_eq!(last.task_ids, ["z"]);
    assert!(last.next_cursor.is_none());
}

#[tokio::test]
async fn collection_filters_properties_before_paging_and_counts_only_visible_tasks() {
    let status = uuid::Uuid::from_u128(50);
    let mut repo = MockInitiativeRepo::new();
    repo.expect_list_accessible().times(2).returning(|_| {
        Box::pin(async {
            Ok(InitiativeList {
                initiatives: vec![summary(3, "Gamma"), summary(2, "Beta"), summary(1, "Alpha")],
            })
        })
    });
    repo.expect_get_detail().times(2).returning(|id| {
        Box::pin(async move {
            let mut d = detail(Vec::new());
            d.id = id;
            d.task_ids = vec!["visible".into(), "hidden".into()];
            Ok(Some(d))
        })
    });
    let selected = InitiativePropertySnapshot {
        status: Some(status),
        ..Default::default()
    };
    let svc = service_with_resources(
        repo,
        FakeResources {
            denied: HashSet::from(["hidden".into()]),
            values: HashMap::from([
                (summary(1, "").id.to_string(), selected.clone()),
                (summary(2, "").id.to_string(), selected),
                (
                    "visible".into(),
                    InitiativePropertySnapshot {
                        completed: true,
                        ..Default::default()
                    },
                ),
            ]),
            ..Default::default()
        },
    );
    let request = InitiativePageRequest {
        limit: Some(1),
        status: Some(status),
        sort: InitiativeSort::Name,
        ..Default::default()
    };
    let first = svc.page(&user(OWNER), request.clone()).await.unwrap();
    assert_eq!(first.initiatives[0].initiative.name, "Alpha");
    assert_eq!(first.initiatives[0].task_count, 1);
    assert_eq!(first.initiatives[0].completed_task_count, 1);
    let last = svc
        .page(
            &user(OWNER),
            InitiativePageRequest {
                cursor: first.next_cursor,
                ..request
            },
        )
        .await
        .unwrap();
    assert_eq!(last.initiatives[0].initiative.name, "Beta");
    assert!(last.next_cursor.is_none());
}

#[tokio::test]
async fn task_references_distinguish_unassigned_from_inaccessible_without_metadata_leaks() {
    let visible_project = summary(1, "Visible").id;
    let hidden_project = summary(2, "Secret").id;
    let mut repo = MockInitiativeRepo::new();
    repo.expect_task_memberships()
        .withf(|ids| ids == &["unassigned", "visible", "secret"])
        .return_once(move |_| {
            Box::pin(async move {
                Ok(HashMap::from([
                    ("visible".into(), visible_project),
                    ("secret".into(), hidden_project),
                ]))
            })
        });
    repo.expect_get_basic()
        .withf(move |id| *id == visible_project)
        .times(1)
        .return_once(move |_| {
            Box::pin(async move {
                Ok(Some(InitiativeBasic {
                    id: visible_project,
                    name: "Visible".into(),
                    owner_id: user(OWNER),
                }))
            })
        });
    let svc = service_with_resources(
        repo,
        FakeResources {
            denied: HashSet::from([hidden_project.to_string(), "hidden-task".into()]),
            ..Default::default()
        },
    );
    let response = svc
        .task_references(
            &user(OWNER),
            TaskInitiativeReferencesRequest {
                task_ids: vec![
                    "unassigned".into(),
                    "visible".into(),
                    "secret".into(),
                    "hidden-task".into(),
                    "visible".into(),
                ],
            },
        )
        .await
        .unwrap();
    assert_eq!(response.references.len(), 4);
    assert!(matches!(
        response.references[0],
        TaskInitiativeReference::None { .. }
    ));
    assert!(matches!(
        response.references[1],
        TaskInitiativeReference::Visible { .. }
    ));
    assert!(matches!(
        response.references[2],
        TaskInitiativeReference::Unavailable { .. }
    ));
    assert!(matches!(
        response.references[3],
        TaskInitiativeReference::Unavailable { .. }
    ));
    assert!(
        !serde_json::to_string(&response)
            .unwrap()
            .contains(&hidden_project.to_string())
    );
}
