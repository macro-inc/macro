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
    let events = Arc::new(super::events::Events::default());
    let svc = InitiativeServiceImpl::new(
        repo,
        documents,
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
    let mut documents = MockInitiativeDescriptionDocuments::new();
    documents
        .expect_create()
        .return_once(|_| Box::pin(async { Ok(description_document_id()) }));
    let events = Arc::new(super::events::Events::default());
    let svc = InitiativeServiceImpl::new(
        repo,
        documents,
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
    repo.expect_get_detail()
        .times(1)
        .return_once(|_| Box::pin(async { Ok(Some(detail(Vec::new()))) }));
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
        repo.expect_get_detail()
            .times(1)
            .return_once(|_| Box::pin(async { Ok(Some(detail(Vec::new()))) }));
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

#[tokio::test]
async fn previews_distinguish_missing_from_inaccessible_without_leaking_hidden_names() {
    let visible = summary(1, "Visible").id;
    let hidden = summary(2, "Secret").id;
    let missing = summary(3, "Gone").id;
    let mut repo = MockInitiativeRepo::new();
    // One narrow read for every well-formed id; malformed ids never reach it.
    repo.expect_get_basics()
        .times(1)
        .withf(move |ids| ids == &[visible, hidden, missing])
        .return_once(move |ids| {
            Box::pin(async move {
                Ok(ids
                    .into_iter()
                    .filter(|id| *id != missing)
                    .map(|id| InitiativeBasic {
                        id,
                        name: if id == visible { "Visible" } else { "Secret" }.into(),
                        owner_id: user(OWNER),
                    })
                    .collect())
            })
        });
    let svc = service_with_resources(
        repo,
        FakeResources {
            denied: HashSet::from([hidden.to_string()]),
            ..Default::default()
        },
    );
    let response = svc
        .previews(
            &user(MEMBER),
            InitiativePreviewsRequest {
                initiative_ids: vec![
                    visible.to_string(),
                    hidden.to_string(),
                    missing.to_string(),
                    "not-a-uuid".into(),
                    visible.to_string(),
                ],
            },
        )
        .await
        .unwrap();
    assert_eq!(
        response.previews,
        vec![
            InitiativePreview::Access {
                id: visible.to_string(),
                name: "Visible".into(),
                owner_id: user(OWNER),
            },
            InitiativePreview::NoAccess {
                id: hidden.to_string(),
            },
            InitiativePreview::DoesNotExist {
                id: missing.to_string(),
            },
            InitiativePreview::DoesNotExist {
                id: "not-a-uuid".into(),
            },
        ]
    );
    assert!(!serde_json::to_string(&response).unwrap().contains("Secret"));
}

#[tokio::test]
async fn previews_reject_oversized_batches_before_reading() {
    let svc = service_with_resources(MockInitiativeRepo::new(), FakeResources::default());
    let error = svc
        .previews(
            &user(OWNER),
            InitiativePreviewsRequest {
                initiative_ids: (0..=MAX_PREVIEW_IDS as u128)
                    .map(|id| uuid::Uuid::from_u128(id).to_string())
                    .collect(),
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        InitiativeError::BadRequest(message) if message.contains("at most 100")
    ));
}

#[tokio::test]
async fn previews_bound_the_raw_payload_even_when_ids_repeat() {
    let svc = service_with_resources(MockInitiativeRepo::new(), FakeResources::default());
    let repeated = uuid::Uuid::from_u128(1).to_string();
    let error = svc
        .previews(
            &user(OWNER),
            InitiativePreviewsRequest {
                initiative_ids: vec![repeated; MAX_PREVIEW_IDS + 1],
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        InitiativeError::BadRequest(message) if message.contains("at most 100")
    ));
}

#[tokio::test]
async fn batch_reads_reject_empty_and_over_long_ids_before_reading() {
    // The mocks carry no expectations: any repository or access read would panic.
    let svc = service_with_resources(MockInitiativeRepo::new(), FakeResources::default());
    for id in [String::new(), "x".repeat(129)] {
        let preview = svc
            .previews(
                &user(OWNER),
                InitiativePreviewsRequest {
                    initiative_ids: vec![id.clone()],
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(
            preview,
            InitiativeError::BadRequest(message) if message == "invalid initiative id"
        ));
        let references = svc
            .task_references(
                &user(OWNER),
                TaskInitiativeReferencesRequest { task_ids: vec![id] },
            )
            .await
            .unwrap_err();
        assert!(matches!(
            references,
            InitiativeError::BadRequest(message) if message == "invalid task id"
        ));
    }
}

#[tokio::test]
async fn task_references_stop_at_the_distinct_id_limit() {
    let svc = service_with_resources(MockInitiativeRepo::new(), FakeResources::default());
    // Duplicates are fine; the first distinct id past the limit is not.
    let mut task_ids: Vec<String> = (0..MAX_TASKS_PER_ASSIGN)
        .flat_map(|index| [format!("task-{index}"), format!("task-{index}")])
        .collect();
    task_ids.push("one-too-many".into());
    let error = svc
        .task_references(&user(OWNER), TaskInitiativeReferencesRequest { task_ids })
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        InitiativeError::BadRequest(message) if message == "at most 100 task ids are allowed"
    ));
}
