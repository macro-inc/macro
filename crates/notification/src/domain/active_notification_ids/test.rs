use super::*;
use std::sync::Mutex;

const KNOWN: &[&str] = &["channel_mention", "document_mention", "reminder"];

#[derive(Default)]
struct FakeRepository {
    reads: Mutex<Vec<(String, Vec<String>, u32)>>,
}

impl ActiveNotificationIdRepository for FakeRepository {
    async fn active_notification_ids(
        &self,
        user: MacroUserIdStr<'_>,
        event_types: &[String],
        limit: u32,
    ) -> Result<Vec<Uuid>, Report> {
        self.reads
            .lock()
            .unwrap()
            .push((user.to_string(), event_types.to_vec(), limit));
        Ok(vec![Uuid::nil()])
    }
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap()
}

#[tokio::test]
async fn reads_the_requested_known_types_for_the_user_with_a_default_limit() {
    let service = ActiveNotificationIdService::new(FakeRepository::default(), KNOWN);

    let ids = service
        .list(
            owner(),
            vec![
                "document_mention".into(),
                "channel_mention".into(),
                "document_mention".into(),
            ],
            None,
        )
        .await
        .unwrap();
    service
        .list(owner(), vec!["reminder".into()], Some(500))
        .await
        .unwrap();

    assert_eq!(ids, vec![Uuid::nil()]);
    assert_eq!(
        *service.repository.reads.lock().unwrap(),
        vec![
            (
                "macro|owner@example.com".to_owned(),
                vec!["channel_mention".to_owned(), "document_mention".to_owned()],
                100,
            ),
            (
                "macro|owner@example.com".to_owned(),
                vec!["reminder".to_owned()],
                500,
            ),
        ]
    );
}

#[tokio::test]
async fn rejects_empty_unknown_and_out_of_range_reads_before_storage() {
    let service = ActiveNotificationIdService::new(FakeRepository::default(), KNOWN);

    assert!(matches!(
        service.list(owner(), Vec::new(), None).await,
        Err(ActiveNotificationIdsError::NoEventTypes)
    ));
    assert!(matches!(
        service
            .list(
                owner(),
                vec!["document_mention".into(), "made_up".into()],
                None
            )
            .await,
        Err(ActiveNotificationIdsError::UnknownEventType(event_type)) if event_type == "made_up"
    ));
    for limit in [0, 501] {
        assert!(matches!(
            service
                .list(owner(), vec!["document_mention".into()], Some(limit))
                .await,
            Err(ActiveNotificationIdsError::InvalidLimit)
        ));
    }
    assert!(service.repository.reads.lock().unwrap().is_empty());
}
