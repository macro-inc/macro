use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};

use super::*;

fn owner(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

#[tokio::test]
async fn each_owner_is_enrolled_by_their_own_flag_and_a_failed_read_is_an_error() {
    let ada = owner("ada@acme.example");
    let bo = owner("bo@acme.example");
    let cy = owner("cy@acme.example");
    let mut flags = FakeFeatureFlags::default();
    flags.set(
        ada.clone(),
        Ok(FlagSnapshot::new([(
            EMAIL_FOCUS_FLAG.to_owned(),
            FlagValue::Boolean(true),
        )])),
    );
    flags.set(bo.clone(), Ok(FlagSnapshot::default()));
    flags.set(cy.clone(), Err("flag definitions unavailable".to_owned()));
    let enrollment = FlagEnrollment::new(flags);

    assert!(enrollment.is_enrolled(&ada).await.unwrap());
    assert!(!enrollment.is_enrolled(&bo).await.unwrap());
    assert!(enrollment.is_enrolled(&cy).await.is_err());
}

mod with_posthog_and_the_database {
    //! The worker's own wiring: the PostHog definitions evaluated locally,
    //! deciding which inboxes in the Focus fixtures the service classifies.

    use std::time::Duration;

    use email::{
        domain::focus::{ClassifyOutcome, FocusService},
        outbound::FocusPgRepository,
    };
    use feature_flags::outbound::posthog_local::PostHogLocalFeatureFlags;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use macro_env::Environment;
    use serde_json::json;
    use sqlx::{Pool, Postgres};
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{method, path},
    };

    use super::*;
    use crate::test_support::{
        NoDueDates, NoProfile, NoReaders, OTHERS_THREAD, OWNERS_THREAD, RecordingClassifier,
    };

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../../../../crates/email/fixtures", scripts("email_focus"))
    )]
    async fn only_inboxes_whose_owner_has_the_flag_are_classified(pool: Pool<Postgres>) {
        let posthog = MockServer::start().await;
        // The rollout's shape: a domain, in one environment.
        Mock::given(method("GET"))
            .and(path("/flags/definitions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"flags": [{
                "key": EMAIL_FOCUS_FLAG, "active": true,
                "filters": {"groups": [{"properties": [
                    {"key": "email", "type": "person", "operator": "icontains", "value": "@acme.example"},
                    {"key": "environment", "type": "person", "operator": "exact", "value": ["prod"]},
                ], "rollout_percentage": 100}]},
            }]})))
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
                PostHogLocalFeatureFlags::new(
                    &posthog.uri(),
                    "test-project-key",
                    "test-secret-key".to_owned(),
                    &[EMAIL_FOCUS_FLAG],
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
        // A sweep reads the same definitions: one poll in all.
        let report = service
            .sweep(chrono::Duration::days(30), 100)
            .await
            .unwrap();
        assert_eq!((report.inboxes, report.inboxes_unknown), (1, 0));
        assert!(!classifier.asked.lock().unwrap().contains(&OTHERS_THREAD));
        assert!(classifier.asked.lock().unwrap().contains(&OWNERS_THREAD));
    }
}
