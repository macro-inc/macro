use super::super::super::write::Cancel;
use super::*;
use std::sync::atomic::Ordering;

#[tokio::test]
async fn planning_reuses_search_counts_and_titles_without_querying_rows() {
    let api = LinkedNotion::default();
    let source = api
        .data_source(&NotionId::parse("dddddddddddddddddddddddddddddddd").unwrap())
        .await
        .unwrap();
    let discovered = discover(
        &api,
        Inventory {
            pages: vec![],
            data_sources: vec![DataSourceSummary {
                source,
                row_count: 77,
                sample_titles: vec!["One".into(), "Two".into()],
            }],
        },
        &Cancel::default(),
        &|_| {},
    )
    .await
    .unwrap();
    assert_eq!(api.row_calls.load(Ordering::SeqCst), 0);
    assert_eq!(discovered.inventory.data_sources[0].row_count, 77);
    assert_eq!(
        discovered.inventory.data_sources[0].sample_titles,
        vec!["One", "Two"]
    );
}

#[tokio::test]
async fn planning_reads_four_page_bodies_at_once_with_a_fixed_bound() {
    let api = LinkedNotion {
        body: Some("Page"),
        gate: Some(tokio::sync::Semaphore::new(0)),
        ..Default::default()
    };
    let pages = (1..=6)
        .map(|n| {
            let id = NotionId::parse(&format!("{n:032x}")).unwrap();
            NotionPage {
                id: id.clone(),
                title: format!("Page {n}"),
                url: id.url(),
                parent: NotionParent::Workspace,
                created: "2026-11-17T00:00:00Z".parse().unwrap(),
                last_edited: "2026-11-17T00:00:00Z".parse().unwrap(),
                in_trash: false,
                properties: Default::default(),
            }
        })
        .collect();
    let cancel = Cancel::default();
    let mut planning = std::pin::pin!(discover(
        &api,
        Inventory {
            pages,
            data_sources: vec![]
        },
        &cancel,
        &|_| {}
    ));
    assert!(futures::poll!(planning.as_mut()).is_pending());
    assert_eq!(api.body_calls.load(Ordering::SeqCst), 4);
    api.gate.as_ref().unwrap().add_permits(4);
    let found = planning.await.unwrap();
    assert_eq!(found.inventory.pages.len(), 6);
    assert_eq!(api.body_calls.load(Ordering::SeqCst), 6);
}

#[tokio::test]
async fn audit_planning_transient_page_reads_remain_retryable() {
    let api = LinkedNotion {
        fail_body: true,
        ..Default::default()
    };
    let id = NotionId::parse("11111111111111111111111111111111").unwrap();
    let result = discover(
        &api,
        Inventory {
            pages: vec![NotionPage {
                id: id.clone(),
                title: "Roadmap".into(),
                url: id.url(),
                parent: NotionParent::Workspace,
                created: "2026-11-17T00:00:00Z".parse().unwrap(),
                last_edited: "2026-11-17T00:00:00Z".parse().unwrap(),
                in_trash: false,
                properties: Default::default(),
            }],
            data_sources: vec![],
        },
        &Cancel::default(),
        &|_| {},
    )
    .await;
    let error = result
        .err()
        .expect("a transient page failure must not become a permanent reviewed omission");
    assert!(matches!(
        error.downcast_ref::<NotionError>(),
        Some(NotionError::Upstream { status: 503, .. })
    ));
}

#[tokio::test]
async fn discovery_checks_cancellation_before_scheduling_page_reads() {
    let api = LinkedNotion::default();
    let cancel = Cancel::default();
    cancel.stop();
    let result = discover(
        &api,
        Inventory {
            pages: vec![],
            data_sources: vec![],
        },
        &cancel,
        &|_| {},
    )
    .await;
    assert!(result.is_err());
    assert_eq!(api.body_calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn page_scan_reports_progress_before_all_page_reads_finish() {
    let api = LinkedNotion {
        body: Some("Page"),
        ..Default::default()
    };
    let id = NotionId::parse("11111111111111111111111111111111").unwrap();
    let pages = vec![NotionPage {
        id: id.clone(),
        title: "Roadmap".into(),
        url: id.url(),
        parent: NotionParent::Workspace,
        created: "2026-11-17T00:00:00Z".parse().unwrap(),
        last_edited: "2026-11-17T00:00:00Z".parse().unwrap(),
        in_trash: false,
        properties: Default::default(),
    }];
    let progress = std::sync::Mutex::new(Vec::new());
    discover(
        &api,
        Inventory {
            pages,
            data_sources: vec![],
        },
        &Cancel::default(),
        &|counts| progress.lock().unwrap().push(counts),
    )
    .await
    .unwrap();
    let progress = progress.lock().unwrap();
    assert_eq!(progress.first().unwrap().pages, 0);
    assert!(progress.iter().any(|counts| counts.pages == 1));
}

#[tokio::test]
async fn review_permanent_tab_failure_retains_readable_tabs_and_missing_positions() {
    let container = NotionId::parse("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").unwrap();
    let page = NotionId::parse("11111111111111111111111111111111").unwrap();
    for missing in ['b', 'c'] {
        let api = LinkedNotion {
            unavailable_view: NotionId::parse(&missing.to_string().repeat(32)),
            ..Default::default()
        };
        let resolved = resolve_page(&api, &page).await.unwrap();
        assert!(
            !resolved.unavailable.contains_key(&container),
            "one deleted tab does not lose the container"
        );
        assert_eq!(
            resolved.views[&container].len(),
            2,
            "tab order includes unavailable positions"
        );
        assert_eq!(resolved.body.occurrences[0].sources.len(), 1);
        let tabs = &resolved.views[&container];
        assert_eq!(tabs[0].id(), &NotionId::parse(&"b".repeat(32)).unwrap());
        assert_eq!(tabs[1].id(), &NotionId::parse(&"c".repeat(32)).unwrap());
        assert!(tabs[usize::from(missing == 'c')].view().is_none());
        assert!(tabs[usize::from(missing == 'b')].view().is_some());
    }
}

#[tokio::test]
async fn audit_cache_reuses_metadata_across_page_references() {
    let api = CachedNotion::new(LinkedNotion::default());
    let pages = ['1', '2']
        .into_iter()
        .map(|value| {
            let id = NotionId::parse(&value.to_string().repeat(32)).unwrap();
            NotionPage {
                url: id.url(),
                id,
                title: "Project".into(),
                parent: NotionParent::Workspace,
                created: "2026-11-17T00:00:00Z".parse().unwrap(),
                last_edited: "2026-11-17T00:00:00Z".parse().unwrap(),
                in_trash: false,
                properties: Default::default(),
            }
        })
        .collect();
    discover(
        &api,
        Inventory {
            pages,
            data_sources: vec![],
        },
        &Cancel::default(),
        &|_| {},
    )
    .await
    .unwrap();
    assert_eq!(api.inner.body_calls.load(Ordering::SeqCst), 2);
    assert_eq!(api.inner.container_calls.load(Ordering::SeqCst), 1);
    assert_eq!(api.inner.source_calls.load(Ordering::SeqCst), 1);
    assert_eq!(api.inner.view_list_calls.load(Ordering::SeqCst), 2);
    assert_eq!(api.inner.view_calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn audit_cache_coalesces_concurrent_source_reads() {
    let api = CachedNotion::new(LinkedNotion {
        source_gate: Some(tokio::sync::Semaphore::new(0)),
        ..Default::default()
    });
    let id = NotionId::parse(&"d".repeat(32)).unwrap();
    let reads = futures::future::join(api.data_source(&id), api.data_source(&id));
    futures::pin_mut!(reads);
    assert!(futures::poll!(&mut reads).is_pending());
    assert_eq!(
        api.inner.source_calls.load(Ordering::SeqCst),
        1,
        "concurrent references share a single metadata request"
    );
    api.inner.source_gate.as_ref().unwrap().add_permits(1);
    let (first, second) = reads.await;
    assert_eq!(first.unwrap().id, second.unwrap().id);
}
