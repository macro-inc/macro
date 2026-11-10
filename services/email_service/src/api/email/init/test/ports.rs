use crate::outbound::{
    inbox_connection::{InitialConnectionBackfill, LoginEmailIdentity},
    persistence_error::InboxPersistenceError,
};
use email::domain::{
    backfill_jobs::{
        BackfillJobQueue, BackfillJobRepository, BackfillJobService, ConnectedInboxEvents,
        ConnectedInboxHistory,
    },
    mailbox::connection::{ConnectionBackfill, ConnectionError, ConnectionIdentity},
};
use models_email::service::{
    backfill::{BackfillJob, BackfillJobStatus},
    link::{Link, UserProvider},
};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};
use tracing_subscriber::{Layer, layer::SubscriberExt};
use uuid::Uuid;

#[derive(Clone, Default)]
struct Logs(Arc<Mutex<Vec<BTreeMap<String, String>>>>);

#[derive(Default)]
struct Fields(BTreeMap<String, String>);

impl tracing::field::Visit for Fields {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        self.0.insert(field.name().into(), format!("{value:?}"));
    }
}

impl<S: tracing::Subscriber> Layer<S> for Logs {
    fn on_event(&self, event: &tracing::Event<'_>, _: tracing_subscriber::layer::Context<'_, S>) {
        let mut fields = Fields::default();
        event.record(&mut fields);
        fields
            .0
            .insert("level".into(), event.metadata().level().to_string());
        self.0.lock().unwrap().push(fields.0);
    }
}

#[test]
fn unavailable_login_email_preserves_the_original_error_log_and_typed_refusal() {
    for (user, cause) in [
        ("missing-delimiter", "invalid user id format"),
        ("macro|", "empty email in user id"),
    ] {
        let logs = Logs::default();
        let subscriber = tracing_subscriber::registry().with(logs.clone());
        let result =
            tracing::subscriber::with_default(subscriber, || LoginEmailIdentity.login_email(user));
        assert!(matches!(
            result,
            Err(ConnectionError::LoginEmailUnavailable)
        ));
        assert_eq!(
            *logs.0.lock().unwrap(),
            [BTreeMap::from([
                ("level".into(), "ERROR".into()),
                ("message".into(), "unable to get email from user id".into()),
                ("error".into(), cause.into()),
            ])]
        );
    }
}

#[derive(Clone, Default)]
struct ConflictingBackfill(Arc<Mutex<Vec<&'static str>>>);

impl BackfillJobRepository for ConflictingBackfill {
    type Err = InboxPersistenceError;

    async fn active_job(&self, _: Uuid) -> Result<Option<BackfillJob>, Self::Err> {
        let mut calls = self.0.lock().unwrap();
        calls.push("active");
        if calls.len() == 1 {
            Ok(None)
        } else {
            Err(anyhow::anyhow!("scripted conflict lookup failure").into())
        }
    }

    async fn insert(
        &self,
        _: Uuid,
        _: &str,
        limit: Option<i32>,
        recovery: bool,
    ) -> Result<Option<BackfillJob>, Self::Err> {
        assert_eq!(limit, None);
        assert!(!recovery);
        self.0.lock().unwrap().push("insert");
        Ok(None)
    }

    async fn job(&self, _: Uuid) -> Result<Option<BackfillJob>, Self::Err> {
        unreachable!("initial connection must not read a job by ID")
    }

    async fn job_in_inbox(&self, _: Uuid, _: Uuid) -> Result<Option<BackfillJob>, Self::Err> {
        unreachable!("initial connection must not read a scoped job")
    }

    async fn jobs_for_user(&self, _: &str) -> Result<Vec<BackfillJob>, Self::Err> {
        unreachable!("initial connection must not list jobs")
    }

    async fn inbox(&self, _: Uuid) -> Result<Option<Link>, Self::Err> {
        unreachable!("initial connection already has the inbox")
    }

    async fn set_status(&self, _: Uuid, _: BackfillJobStatus) -> Result<(), Self::Err> {
        unreachable!("a lookup failure must not change job status")
    }

    async fn fail_active(&self, _: Uuid) -> Result<bool, Self::Err> {
        unreachable!("a lookup failure must not fail a job")
    }
}

impl BackfillJobQueue for ConflictingBackfill {
    type Err = InboxPersistenceError;

    async fn enqueue_initialization(&self, _: Uuid, _: Uuid) -> Result<(), Self::Err> {
        self.0.lock().unwrap().push("enqueue");
        Ok(())
    }
}

impl ConnectedInboxHistory for ConflictingBackfill {
    async fn record(&self, _: &Link) {
        self.0.lock().unwrap().push("history");
    }
}

impl ConnectedInboxEvents for ConflictingBackfill {
    fn connected(&self, _: &Link) {
        self.0.lock().unwrap().push("connected");
    }
}

#[tokio::test]
async fn conflict_lookup_failure_retains_legacy_context_without_publishing() {
    let fake = ConflictingBackfill::default();
    let adapter = InitialConnectionBackfill {
        jobs: Arc::new(BackfillJobService {
            repository: fake.clone(),
            queue: fake.clone(),
        }),
        history: fake.clone(),
        events: fake.clone(),
    };
    let link = Link {
        id: Uuid::from_u128(1),
        macro_id: "macro|owner@example.com".to_owned().try_into().unwrap(),
        fusionauth_user_id: "fusion-owner".into(),
        email_address: "inbox@example.com".to_owned().try_into().unwrap(),
        provider: UserProvider::Gmail,
        is_sync_active: true,
        is_primary: false,
        needs_reauth: false,
        last_sync_error_at: None,
        created_at: Default::default(),
        updated_at: Default::default(),
    };
    let error = adapter.start(&link).await.unwrap_err();
    let debug = format!("{error:?}");
    let ConnectionError::DatabaseError(source) = error else {
        panic!("expected database error, got {debug}");
    };
    let context = "Failed to fetch in-flight backfill job after insert conflict";
    assert_eq!(
        source.chain().map(ToString::to_string).collect::<Vec<_>>(),
        [context, "scripted conflict lookup failure"]
    );
    assert!(debug.contains(context), "{debug}");
    assert!(
        debug.contains("scripted conflict lookup failure"),
        "{debug}"
    );
    assert_eq!(*fake.0.lock().unwrap(), ["active", "insert", "active"]);
}
