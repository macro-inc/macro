use std::sync::atomic::{AtomicUsize, Ordering};

use feature_flags::{FlagSnapshot, FlagValue};

use super::*;

/// Answers from a list, one per load, counting the loads.
#[derive(Default)]
struct ScriptedFlags {
    answers: Mutex<Vec<Result<bool, &'static str>>>,
    loads: AtomicUsize,
}

impl ScriptedFlags {
    fn answering(answers: Vec<Result<bool, &'static str>>) -> Self {
        Self {
            answers: Mutex::new(answers.into_iter().rev().collect()),
            loads: AtomicUsize::new(0),
        }
    }
}

impl FeatureFlags for ScriptedFlags {
    async fn load(&self, _user_id: &MacroUserIdStr<'_>) -> Result<FlagSnapshot, Report> {
        self.loads.fetch_add(1, Ordering::SeqCst);
        match self
            .answers
            .lock()
            .unwrap()
            .pop()
            .expect("an answer per load")
        {
            Ok(enabled) => Ok(FlagSnapshot::new([(
                EMAIL_FOCUS_FLAG.to_owned(),
                FlagValue::Boolean(enabled),
            )])),
            Err(message) => Err(rootcause::report!("{message}")),
        }
    }
}

fn owner(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

#[tokio::test(start_paused = true)]
async fn an_answer_stands_for_an_hour_then_is_read_again() {
    let enrollment = FlagEnrollment::new(ScriptedFlags::answering(vec![Ok(true), Ok(false)]));
    let ada = owner("ada@acme.example");

    assert!(enrollment.is_enrolled(&ada).await.unwrap());
    tokio::time::advance(Duration::from_secs(59 * 60)).await;
    assert!(enrollment.is_enrolled(&ada).await.unwrap());
    assert_eq!(enrollment.flags.loads.load(Ordering::SeqCst), 1);

    // The rollout stepped back: seen once the hour is up.
    tokio::time::advance(Duration::from_secs(60)).await;
    assert!(!enrollment.is_enrolled(&ada).await.unwrap());
    assert_eq!(enrollment.flags.loads.load(Ordering::SeqCst), 2);
}

#[tokio::test(start_paused = true)]
async fn an_owner_outside_the_rollout_is_read_again_after_ten_minutes() {
    let enrollment = FlagEnrollment::new(ScriptedFlags::answering(vec![Ok(false), Ok(true)]));
    let ada = owner("ada@acme.example");

    assert!(!enrollment.is_enrolled(&ada).await.unwrap());
    tokio::time::advance(Duration::from_secs(9 * 60)).await;
    assert!(!enrollment.is_enrolled(&ada).await.unwrap());
    assert_eq!(enrollment.flags.loads.load(Ordering::SeqCst), 1);

    // The rollout stepped up: seen once ten minutes are up.
    tokio::time::advance(Duration::from_secs(60)).await;
    assert!(enrollment.is_enrolled(&ada).await.unwrap());
    assert_eq!(enrollment.flags.loads.load(Ordering::SeqCst), 2);
}

#[tokio::test(start_paused = true)]
async fn each_owner_has_their_own_answer() {
    let enrollment = FlagEnrollment::new(ScriptedFlags::answering(vec![Ok(true), Ok(false)]));
    let ada = owner("ada@acme.example");
    let bo = owner("bo@acme.example");

    assert!(enrollment.is_enrolled(&ada).await.unwrap());
    assert!(!enrollment.is_enrolled(&bo).await.unwrap());
    assert!(enrollment.is_enrolled(&ada).await.unwrap());
    assert!(!enrollment.is_enrolled(&bo).await.unwrap());
    assert_eq!(enrollment.flags.loads.load(Ordering::SeqCst), 2);
}

#[tokio::test(start_paused = true)]
async fn a_failed_read_is_not_kept() {
    let enrollment = FlagEnrollment::new(ScriptedFlags::answering(vec![
        Err("flag service down"),
        Ok(true),
    ]));
    let ada = owner("ada@acme.example");

    assert!(enrollment.is_enrolled(&ada).await.is_err());
    assert!(enrollment.is_enrolled(&ada).await.unwrap());
    assert_eq!(enrollment.flags.loads.load(Ordering::SeqCst), 2);
}

mod with_posthog_and_the_database {
    //! The worker's own wiring: the PostHog adapter behind the cache, deciding
    //! which inboxes in the Focus fixtures the service classifies.

    use email::{
        domain::focus::{ClassifyOutcome, FocusService},
        outbound::FocusPgRepository,
    };
    use feature_flags::outbound::posthog::PostHogFeatureFlags;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use macro_env::Environment;
    use serde_json::{Value, json};
    use sqlx::{Pool, Postgres};
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{body_partial_json, method, path},
    };

    use super::*;
    use crate::test_support::{
        NoDueDates, NoProfile, NoReaders, OTHERS_THREAD, OWNERS_THREAD, RecordingClassifier,
    };

    fn flags(enabled: bool) -> Value {
        json!({
            "flags": {EMAIL_FOCUS_FLAG: {"key": EMAIL_FOCUS_FLAG, "enabled": enabled}},
            "errorsWhileComputingFlags": false,
            "requestId": "test-request",
        })
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../../../../crates/email/fixtures", scripts("email_focus"))
    )]
    async fn only_inboxes_whose_owner_has_the_flag_are_classified(pool: Pool<Postgres>) {
        let posthog = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/flags/"))
            .and(body_partial_json(
                json!({"distinct_id": "macro|owner@acme.example"}),
            ))
            .respond_with(ResponseTemplate::new(200).set_body_json(flags(true)))
            .expect(1)
            .mount(&posthog)
            .await;
        Mock::given(method("POST"))
            .and(path("/flags/"))
            .and(body_partial_json(
                json!({"distinct_id": "macro|other@elsewhere.example"}),
            ))
            .respond_with(ResponseTemplate::new(200).set_body_json(flags(false)))
            .expect(1)
            .mount(&posthog)
            .await;
        let classifier = RecordingClassifier::new(Duration::ZERO);
        let service = FocusService::new(
            FocusPgRepository(pool),
            NoProfile,
            classifier.clone(),
            NoReaders,
            NoDueDates::default(),
            FlagEnrollment::new(
                PostHogFeatureFlags::new(
                    &posthog.uri(),
                    "test-project-key".to_owned(),
                    Duration::from_secs(2),
                    Environment::Production,
                )
                .unwrap(),
            ),
        );

        // Mail in both inboxes: only the owner with the flag is classified.
        assert!(matches!(
            service.classify_thread(OWNERS_THREAD).await.unwrap(),
            ClassifyOutcome::Classified(_)
        ));
        assert_eq!(
            service.classify_thread(OTHERS_THREAD).await.unwrap(),
            ClassifyOutcome::NotEnabled
        );
        // More mail and a sweep ask PostHog nothing new within the hour.
        assert_eq!(
            service.classify_thread(OTHERS_THREAD).await.unwrap(),
            ClassifyOutcome::NotEnabled
        );
        let report = service
            .sweep(chrono::Duration::days(30), 100)
            .await
            .unwrap();
        assert_eq!((report.inboxes, report.inboxes_unknown), (1, 0));
        assert!(!classifier.asked.lock().unwrap().contains(&OTHERS_THREAD));
        assert!(classifier.asked.lock().unwrap().contains(&OWNERS_THREAD));
    }
}
