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
    /// Every project's tasks, from their Project property.
    tasks: Vec<String>,
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
    fn set_initial_properties(
        &self,
        _owner: MacroUserIdStr<'static>,
        _id: InitiativeId,
        _values: Vec<crate::domain::models::InitialPropertyValue>,
    ) -> ResourceFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
    fn purge(&self, _receipt: EntityAccessReceipt<EditAccessLevel>) -> ResourceFuture<'_, ()> {
        Box::pin(async { Ok(()) })
    }
    fn project_tasks(&self, _id: InitiativeId) -> ResourceFuture<'_, Vec<String>> {
        Box::pin(async { Ok(self.tasks.clone()) })
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

fn service_with_resources(repo: MockInitiativeRepo, resources: FakeResources) -> TestService {
    InitiativeServiceImpl::new(
        repo,
        MockInitiativeDescriptionSurfaces::new(),
        Arc::new(resources),
    )
}

fn summary(id: u128, name: &str) -> InitiativeSummary {
    InitiativeSummary {
        id: InitiativeId::from_uuid(uuid::Uuid::from_u128(id)),
        name: name.into(),
        updated_at: now(),
    }
}

#[tokio::test]
async fn single_summary_counts_only_visible_tasks_and_uses_canonical_properties() {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_get_detail()
        .times(1)
        .return_once(|_| Box::pin(async { Ok(Some(detail(Vec::new()))) }));
    let status = uuid::Uuid::from_u128(50);
    let project_id = detail(Vec::new()).id.to_string();
    let svc = service_with_resources(
        repo,
        FakeResources {
            denied: HashSet::from(["hidden".into()]),
            tasks: vec!["open".into(), "done".into(), "hidden".into()],
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
        .return_once(|_| Box::pin(async { Ok(()) }));
    let events = Arc::new(super::events::Events::default());
    let svc = InitiativeServiceImpl::new(
        repo,
        // The deleted initiative's surface is retired too.
        deleting_surfaces(),
        Arc::new(FakeResources {
            fail_initialization: true,
            ..Default::default()
        }),
    )
    .with_event_publisher(events.clone());
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
    assert!(matches!(
        events.0.lock().unwrap().as_slice(),
        [crate::domain::events::InitiativeTopicEvent::Purged { .. }]
    ));
}

#[tokio::test]
async fn failed_initialization_compensation_does_not_purge_a_remaining_project() {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_get_team_default_link_share()
        .return_once(|_| Box::pin(async { Ok(None) }));
    repo.expect_create()
        .return_once(|_, _, _| Box::pin(async { Ok(detail(Vec::new())) }));
    repo.expect_delete().times(1).return_once(|_| {
        Box::pin(async {
            Err(InitiativeError::Internal(rootcause::report!(
                "delete failed"
            )))
        })
    });
    let events = Arc::new(super::events::Events::default());
    let svc = InitiativeServiceImpl::new(
        repo,
        // The initiative still exists, so its surface is left alone.
        MockInitiativeDescriptionSurfaces::new(),
        Arc::new(FakeResources {
            fail_initialization: true,
            ..Default::default()
        }),
    )
    .with_event_publisher(events.clone());
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
    assert!(events.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn task_paging_filters_visibility_before_counting_and_page_boundaries() {
    let mut repo = MockInitiativeRepo::new();
    repo.expect_get_detail()
        .times(2)
        .returning(|_| Box::pin(async { Ok(Some(detail(Vec::new()))) }));
    let svc = service_with_resources(
        repo,
        FakeResources {
            denied: HashSet::from(["hidden".into()]),
            tasks: vec!["z".into(), "hidden".into(), "a".into()],
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
    let selected = InitiativePropertySnapshot {
        status: Some(status),
        ..Default::default()
    };
    let svc = service_with_resources(
        repo,
        FakeResources {
            denied: HashSet::from(["hidden".into()]),
            tasks: vec!["visible".into(), "hidden".into()],
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
async fn cursors_remain_bounded_and_preserve_full_unicode_name_ordering() {
    let prefix = format!("A{}", "\u{301}".repeat(1500));
    let names = [
        format!("{prefix}a"),
        format!("{prefix}a"),
        format!("{prefix}b"),
    ];
    for name in &names {
        super::super::normalize_name(name).expect("valid short grapheme count");
        assert!(name.len() > 2048);
    }
    let mut repo = MockInitiativeRepo::new();
    repo.expect_list_accessible().returning(move |_| {
        let initiatives = names
            .iter()
            .enumerate()
            .rev()
            .map(|(i, name)| summary(i as u128 + 1, name))
            .collect();
        Box::pin(async move { Ok(InitiativeList { initiatives }) })
    });
    repo.expect_get_detail().returning(|id| {
        Box::pin(async move {
            let mut value = detail(Vec::new());
            value.id = id;
            Ok(Some(value))
        })
    });
    let svc = service_with_resources(repo, FakeResources::default());
    for sort in [
        InitiativeSort::Name,
        InitiativeSort::Updated,
        InitiativeSort::Due,
    ] {
        for descending in [false, true] {
            let mut request = InitiativePageRequest {
                limit: Some(1),
                sort,
                descending: Some(descending),
                ..Default::default()
            };
            let mut ids = Vec::new();
            loop {
                let page = svc.page(&user(OWNER), request.clone()).await.unwrap();
                ids.extend(
                    page.initiatives
                        .into_iter()
                        .map(|row| row.initiative.id.as_uuid().as_u128()),
                );
                request.cursor = page.next_cursor;
                let Some(cursor) = &request.cursor else {
                    break;
                };
                assert!(cursor.len() <= 2048);
                assert!(ids.len() < 3, "cursor must advance");
            }
            assert_eq!(
                ids,
                if descending {
                    vec![3, 2, 1]
                } else {
                    vec![1, 2, 3]
                }
            );
        }
    }
}

#[tokio::test]
async fn removed_name_cursor_anchor_requires_restarting_instead_of_silently_skipping_rows() {
    let mut repo = MockInitiativeRepo::new();
    let mut sequence = Sequence::new();
    repo.expect_list_accessible()
        .times(1)
        .in_sequence(&mut sequence)
        .return_once(|_| {
            Box::pin(async {
                Ok(InitiativeList {
                    initiatives: vec![summary(1, "Alpha"), summary(2, "Beta")],
                })
            })
        });
    repo.expect_list_accessible()
        .times(1)
        .in_sequence(&mut sequence)
        .return_once(|_| {
            Box::pin(async {
                Ok(InitiativeList {
                    initiatives: vec![summary(2, "Beta")],
                })
            })
        });
    let svc = service_with_resources(repo, FakeResources::default());
    let mut request = InitiativePageRequest {
        limit: Some(1),
        sort: InitiativeSort::Name,
        ..Default::default()
    };
    request.cursor = svc
        .page(&user(OWNER), request.clone())
        .await
        .unwrap()
        .next_cursor;
    let error = svc.page(&user(OWNER), request).await.unwrap_err();
    assert!(
        matches!(error, InitiativeError::BadRequest(message) if message.contains("restart pagination"))
    );
}

#[tokio::test]
async fn renamed_name_cursor_anchor_requires_restarting_in_both_directions() {
    for descending in [false, true] {
        let mut repo = MockInitiativeRepo::new();
        let mut sequence = Sequence::new();
        repo.expect_list_accessible()
            .times(1)
            .in_sequence(&mut sequence)
            .return_once(|_| {
                Box::pin(async {
                    Ok(InitiativeList {
                        initiatives: vec![summary(1, "Alpha"), summary(2, "Beta")],
                    })
                })
            });
        repo.expect_list_accessible()
            .times(1)
            .in_sequence(&mut sequence)
            .return_once(move |_| {
                Box::pin(async move {
                    let mut renamed = if descending {
                        summary(2, "Aaron")
                    } else {
                        summary(1, "Zulu")
                    };
                    renamed.updated_at += chrono::Duration::seconds(1);
                    Ok(InitiativeList {
                        initiatives: vec![
                            renamed,
                            if descending {
                                summary(1, "Alpha")
                            } else {
                                summary(2, "Beta")
                            },
                        ],
                    })
                })
            });
        let svc = service_with_resources(repo, FakeResources::default());
        let mut request = InitiativePageRequest {
            limit: Some(1),
            sort: InitiativeSort::Name,
            descending: Some(descending),
            ..Default::default()
        };
        let first = svc.page(&user(OWNER), request.clone()).await.unwrap();
        assert_eq!(first.initiatives.len(), 1);
        request.cursor = first.next_cursor;
        assert!(request.cursor.is_some());
        // Continuing from the anchor's new name would silently skip Beta/Alpha.
        let error = svc.page(&user(OWNER), request).await.unwrap_err();
        assert!(matches!(
            error,
            InitiativeError::BadRequest(message) if message.contains("restart pagination")
        ));
    }
}
