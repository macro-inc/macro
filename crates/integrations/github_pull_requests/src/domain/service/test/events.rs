use super::*;

#[derive(Clone)]
struct RecordingPublisher {
    events: Arc<Mutex<Vec<crate::domain::events::GithubPullRequestUpdated>>>,
    rows: StubPullRequestRows,
    fail: bool,
}
impl crate::domain::ports::GithubPullRequestEventPublisher for RecordingPublisher {
    fn publish_updated(
        &self,
        update: crate::domain::events::GithubPullRequestUpdated,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<(), rootcause::Report>> + Send + '_>> {
        Box::pin(async move {
            assert!(
                self.rows
                    .rows()
                    .iter()
                    .any(|row| row.github_key == update.github_key),
                "publish only after typed row persistence"
            );
            self.events.lock().unwrap().push(update);
            if self.fail {
                Err(rootcause::report!("broker unavailable"))
            } else {
                Ok(())
            }
        })
    }
}

#[tokio::test]
async fn publishes_only_changed_records_after_storage_and_coalesces_refresh() {
    let foreign = StubForeignEntityService::default();
    let rows = StubPullRequestRows::default();
    let events = Arc::new(Mutex::new(Vec::new()));
    let service = service(&foreign, &rows).with_event_publisher(RecordingPublisher {
        events: events.clone(),
        rows: rows.clone(),
        fail: false,
    });
    let open = pull_request(GithubPullRequestStatus::Open);
    let personal = service
        .upsert_pull_request(UpsertGithubPullRequest {
            pull_request: open.clone(),
            stored_for: user(),
        })
        .await
        .unwrap();
    let shared = service
        .upsert_pull_request(UpsertGithubPullRequest {
            pull_request: open.clone(),
            stored_for: team(),
        })
        .await
        .unwrap();
    assert_eq!(events.lock().unwrap().len(), 2);
    service
        .upsert_pull_request(UpsertGithubPullRequest {
            pull_request: open.clone(),
            stored_for: user(),
        })
        .await
        .unwrap();
    service.refresh_pull_request(&open).await.unwrap();
    assert_eq!(
        events.lock().unwrap().len(),
        2,
        "unchanged enrichments must not generate traffic"
    );

    service
        .refresh_pull_request(&pull_request(GithubPullRequestStatus::Merged))
        .await
        .unwrap();
    let events = events.lock().unwrap();
    assert_eq!(events.len(), 3, "one fact per refresh, not per source");
    assert_eq!(events[2].github_key, GITHUB_KEY);
    assert_eq!(
        events[2].foreign_entity_ids,
        vec![personal.foreign_entity.id, shared.foreign_entity.id]
    );
}

#[tokio::test]
async fn successful_retry_publishes_records_committed_by_a_partial_refresh() {
    for failed_record_first in [true, false] {
        let open = pull_request(GithubPullRequestStatus::Open)
            .foreign_entity_metadata(None)
            .unwrap();
        let failed = stored_record(&team(), open.clone());
        let successful = stored_record(&user(), open.clone());
        let records = if failed_record_first {
            vec![failed.clone(), successful.clone()]
        } else {
            vec![successful.clone(), failed.clone()]
        };
        let expected_ids = records.iter().map(|record| record.id).collect::<Vec<_>>();
        let foreign = StubForeignEntityService::with_records(records);
        foreign.state.lock().unwrap().failing_patches = vec![failed.id];
        let rows = StubPullRequestRows::default();
        let original_row = GithubPullRequestRow::from_metadata(&open).unwrap();
        rows.rows.lock().unwrap().push(original_row.clone());
        let events = Arc::new(Mutex::new(Vec::new()));
        let service = service(&foreign, &rows).with_event_publisher(RecordingPublisher {
            events: events.clone(),
            rows: rows.clone(),
            fail: false,
        });
        let closed = pull_request(GithubPullRequestStatus::Closed);

        assert!(service.refresh_pull_request(&closed).await.is_err());
        assert_eq!(foreign.patches().len(), 2);
        assert_eq!(rows.rows(), vec![original_row]);
        assert!(events.lock().unwrap().is_empty());
        assert_eq!(
            foreign
                .records()
                .iter()
                .find(|record| record.id == successful.id)
                .unwrap()
                .metadata["status"],
            "closed"
        );

        foreign.state.lock().unwrap().failing_patches.clear();
        service.refresh_pull_request(&closed).await.unwrap();
        assert_eq!(rows.rows()[0].status, Some(GithubPullRequestStatus::Closed));
        {
            let events = events.lock().unwrap();
            assert_eq!(events.len(), 1);
            assert_eq!(events[0].github_key, GITHUB_KEY);
            assert_eq!(events[0].foreign_entity_ids, expected_ids);
        }

        service.refresh_pull_request(&closed).await.unwrap();
        assert_eq!(events.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn failed_publication_does_not_report_a_committed_write_as_failed() {
    let foreign = StubForeignEntityService::default();
    let rows = StubPullRequestRows::default();
    let service = service(&foreign, &rows).with_event_publisher(RecordingPublisher {
        events: Arc::default(),
        rows: rows.clone(),
        fail: true,
    });
    let saved = service
        .upsert_pull_request(UpsertGithubPullRequest {
            pull_request: pull_request(GithubPullRequestStatus::Open),
            stored_for: user(),
        })
        .await
        .unwrap();
    assert_eq!(foreign.records()[0].id, saved.foreign_entity.id);
}
