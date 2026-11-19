
    type FlagService = FocusService<
        FocusPgRepository,
        NoProfile,
        RecordingClassifier,
        NoReaders,
        NoDueDates,
        FlagEnrollment<PostHogLocalFeatureFlags>,
    >;

    /// PostHog serving a rollout to one address only.
    async fn posthog_enrolling(email: &str) -> MockServer {
        let posthog = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/flags/definitions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"flags": [{
                "key": EMAIL_FOCUS_FLAG, "active": true,
                "filters": {"groups": [{"properties": [
                    {"key": "email", "type": "person", "operator": "exact", "value": [email]},
                ], "rollout_percentage": 100}]},
            }]})))
            .mount(&posthog)
            .await;
        posthog
    }

    fn flag_service(
        pool: Pool<Postgres>,
        posthog: &MockServer,
        classifier: &RecordingClassifier,
    ) -> FlagService {
        FocusService::new(
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
        )
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(
            path = "../../../../../crates/email/fixtures",
            scripts("email_focus", "email_focus_linked")
        )
    )]
    async fn a_linked_inbox_follows_the_flag_of_the_user_it_is_linked_to(pool: Pool<Postgres>) {
        // Only the primary user has the flag; the linked inbox's own owner,
        // other@elsewhere.example, does not.
        let posthog = posthog_enrolling("owner@acme.example").await;
        let classifier = RecordingClassifier::new(Duration::ZERO);
        let service = flag_service(pool.clone(), &posthog, &classifier);

        // Live mail: the linked inbox is classified.
        assert!(matches!(
            service.classify_thread(OTHERS_THREAD).await.unwrap(),
            ClassifyOutcome::Classified(_)
        ));
        // The every-minute look finds it, so a primary user who joins gets it
        // backfilled, and the backfill fills it.
        let found = service.enrolled_inboxes(4).await.unwrap();
        let linked = found
            .enrolled
            .iter()
            .find(|inbox| inbox.link_id == OTHERS_LINK)
            .expect("the linked inbox is enrolled");
        assert_eq!(found.enrolled.len(), 2);
        let backfill = service
            .backfill(linked, chrono::Duration::days(30), 4, DueDates::Read)
            .await
            .unwrap();
        assert_eq!(backfill.inboxes, 1);
        // The hourly sweep covers both inboxes the primary user's tab shows.
        let report = service
            .sweep(chrono::Duration::days(30), 100)
            .await
            .unwrap();
        assert_eq!((report.inboxes, report.inboxes_unknown), (2, 0));

        // The flag off for the primary user: their linked inbox stops too.
        let classifier = RecordingClassifier::new(Duration::ZERO);
        let off = posthog_enrolling("nobody@acme.example").await;
        let service = flag_service(pool, &off, &classifier);
        assert_eq!(
            service.classify_thread(OTHERS_THREAD).await.unwrap(),
            ClassifyOutcome::NotEnabled
        );
        assert_eq!(
            service.enrolled_inboxes(4).await.unwrap().enrolled,
            Vec::new()
        );
        let report = service
            .sweep(chrono::Duration::days(30), 100)
            .await
            .unwrap();
        assert_eq!(report.inboxes, 0);
        assert!(classifier.asked.lock().unwrap().is_empty());
    }
