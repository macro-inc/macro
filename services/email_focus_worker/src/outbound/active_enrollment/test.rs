use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use chrono::DateTime;

use super::*;
use crate::test_support::Enrolled;

const WEEK: chrono::Duration = chrono::Duration::days(7);
const REMEMBER: Duration = Duration::from_secs(300);

fn person(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

/// Who was asked about, and from when.
type Asked = Vec<(String, DateTime<Utc>)>;

/// Answers from a table of who is active, recording each question; a person
/// missing from the table can't be read.
#[derive(Clone, Default)]
struct FakeActivity {
    active: Arc<Mutex<HashMap<String, bool>>>,
    asked: Arc<Mutex<Asked>>,
}

impl FakeActivity {
    fn set(&self, email: &str, active: bool) {
        self.active
            .lock()
            .unwrap()
            .insert(person(email).as_ref().to_owned(), active);
    }

    fn asked(&self) -> usize {
        self.asked.lock().unwrap().len()
    }
}

impl UserActivity for FakeActivity {
    type Err = std::io::Error;

    async fn is_active(
        &self,
        user: &MacroUserIdStr<'_>,
        since: DateTime<Utc>,
    ) -> Result<bool, Self::Err> {
        self.asked
            .lock()
            .unwrap()
            .push((user.as_ref().to_owned(), since));
        self.active
            .lock()
            .unwrap()
            .get(user.as_ref())
            .copied()
            .ok_or_else(|| std::io::Error::other("activity unavailable"))
    }
}

fn enrollment(activity: &FakeActivity) -> ActiveEnrollment<Enrolled, FakeActivity> {
    ActiveEnrollment::new(
        Enrolled::owner("ada@acme.example"),
        activity.clone(),
        WEEK,
        REMEMBER,
    )
}

#[tokio::test(start_paused = true)]
async fn only_people_in_the_rollout_are_asked_about_and_only_the_active_ones_are_in() {
    let activity = FakeActivity::default();
    activity.set("ada@acme.example", true);
    activity.set("bo@acme.example", true);
    let enrollment = enrollment(&activity);

    assert!(
        enrollment
            .is_enrolled(&person("ada@acme.example"))
            .await
            .unwrap()
    );
    // Bo is around but not in the rollout, so nobody looks Bo up.
    assert!(
        !enrollment
            .is_enrolled(&person("bo@acme.example"))
            .await
            .unwrap()
    );
    let asked = activity.asked.lock().unwrap().clone();
    assert_eq!(asked.len(), 1);
    let (who, since) = &asked[0];
    assert_eq!(who, person("ada@acme.example").as_ref());
    let window = Utc::now() - *since;
    assert!(window >= WEEK && window < WEEK + chrono::Duration::seconds(5));
}

#[tokio::test(start_paused = true)]
async fn someone_away_is_out_until_they_come_back_and_the_answer_runs_out() {
    let activity = FakeActivity::default();
    activity.set("ada@acme.example", false);
    let enrollment = enrollment(&activity);
    let ada = person("ada@acme.example");

    assert!(!enrollment.is_enrolled(&ada).await.unwrap());
    // Back, but the answer is remembered: still out, and not asked again.
    activity.set("ada@acme.example", true);
    tokio::time::advance(REMEMBER - Duration::from_secs(1)).await;
    assert!(!enrollment.is_enrolled(&ada).await.unwrap());
    assert_eq!(activity.asked(), 1);

    tokio::time::advance(Duration::from_secs(1)).await;
    assert!(enrollment.is_enrolled(&ada).await.unwrap());
    assert_eq!(activity.asked(), 2);
}

#[tokio::test(start_paused = true)]
async fn an_unreadable_activity_is_unknown_and_asked_again_next_time() {
    let activity = FakeActivity::default();
    let enrollment = enrollment(&activity);
    let ada = person("ada@acme.example");

    assert!(enrollment.is_enrolled(&ada).await.is_err());
    activity.set("ada@acme.example", true);
    assert!(enrollment.is_enrolled(&ada).await.unwrap());
    assert_eq!(activity.asked(), 2);
}

#[tokio::test(start_paused = true)]
async fn answers_about_people_nobody_asks_about_any_more_are_dropped() {
    let activity = FakeActivity::default();
    activity.set("ada@acme.example", true);
    activity.set("cy@acme.example", true);
    let enrollment = ActiveEnrollment::new(
        Enrolled(
            [person("ada@acme.example"), person("cy@acme.example")]
                .into_iter()
                .collect(),
        ),
        activity.clone(),
        WEEK,
        REMEMBER,
    );

    enrollment
        .is_enrolled(&person("ada@acme.example"))
        .await
        .unwrap();
    tokio::time::advance(REMEMBER * 2).await;
    enrollment
        .is_enrolled(&person("cy@acme.example"))
        .await
        .unwrap();

    let answers = enrollment.answers.lock().unwrap();
    assert_eq!(answers.by_user.len(), 1);
    assert!(answers.by_user.contains_key(&person("cy@acme.example")));
}

mod with_the_database {
    //! The worker's wiring against the activity tables: an owner in the
    //! rollout who has been away gets nothing from any path, and everything
    //! once they are seen again.

    use activity::{SeenLog, outbound::pg_activity_repo::PgActivityRepo};
    use email::{
        domain::focus::{ClassifyOutcome, DueDates, FocusInboxOwner, FocusService},
        outbound::FocusPgRepository,
    };
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use sqlx::{Pool, Postgres};
    use uuid::Uuid;

    use super::*;
    use crate::test_support::{
        NoDueDates, NoProfile, NoReaders, OTHERS_LINK, OTHERS_THREAD, OWNERS_LINK, OWNERS_THREAD,
        RecordingClassifier,
    };

    const OWNER: &str = "owner@acme.example";
    const OTHER: &str = "other@elsewhere.example";
    /// Thread f204 in link f01: signal mail from three days ago.
    const OWNERS_OLDER_THREAD: Uuid = uuid::uuid!("00000000-0000-0000-0000-00000000f204");
    const MONTH: chrono::Duration = chrono::Duration::days(30);

    type Service = FocusService<
        FocusPgRepository,
        NoProfile,
        RecordingClassifier,
        NoReaders,
        NoDueDates,
        ActiveEnrollment<Enrolled, PgActivityRepo>,
    >;

    /// Focus for everyone in `rollout` who was active within `within`, with
    /// nothing remembered, so a change in activity shows at once.
    fn service(
        pool: &Pool<Postgres>,
        rollout: Enrolled,
        within: chrono::Duration,
        classifier: &RecordingClassifier,
    ) -> Service {
        FocusService::new(
            FocusPgRepository(pool.clone()),
            NoProfile,
            classifier.clone(),
            NoReaders,
            NoDueDates::default(),
            ActiveEnrollment::new(
                rollout,
                PgActivityRepo::new(pool.clone()),
                within,
                Duration::ZERO,
            ),
        )
    }

    async fn insert_person(pool: &Pool<Postgres>, email: &str) {
        let macro_user_id = Uuid::now_v7();
        let user_id = person(email);
        sqlx::query!(
            r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)"#,
            macro_user_id,
            email,
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query!(
            r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
            user_id.as_ref(),
            email,
            macro_user_id,
        )
        .execute(pool)
        .await
        .unwrap();
    }

    async fn seen(pool: &Pool<Postgres>, email: &str, ago: chrono::Duration) {
        PgActivityRepo::new(pool.clone())
            .record_seen(&[person(email)], Utc::now() - ago)
            .await
            .unwrap();
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../../../../crates/email/fixtures", scripts("email_focus"))
    )]
    async fn an_owner_away_for_a_week_gets_no_focus_work_until_seen(pool: Pool<Postgres>) {
        insert_person(&pool, OWNER).await;
        seen(&pool, OWNER, chrono::Duration::days(8)).await;
        // Within a month the owner was around, so their inbox holds Focus.
        let earlier = RecordingClassifier::new(Duration::ZERO);
        assert!(matches!(
            service(&pool, Enrolled::owner(OWNER), MONTH, &earlier)
                .classify_thread(OWNERS_THREAD)
                .await
                .unwrap(),
            ClassifyOutcome::Classified(_)
        ));

        // Not within the week: live mail, the look, a backfill and the sweep
        // all leave the inbox alone, though it holds Focus.
        let classifier = RecordingClassifier::new(Duration::ZERO);
        let service = service(&pool, Enrolled::owner(OWNER), WEEK, &classifier);
        assert_eq!(
            service.classify_thread(OWNERS_OLDER_THREAD).await.unwrap(),
            ClassifyOutcome::NotEnabled
        );
        assert!(
            service
                .enrolled_inboxes(4)
                .await
                .unwrap()
                .enrolled
                .is_empty()
        );
        let owners = FocusInboxOwner {
            link_id: OWNERS_LINK,
            owner: person(OWNER),
            delegates: Vec::new(),
        };
        let backfill = service
            .backfill(&owners, MONTH, 4, DueDates::Read)
            .await
            .unwrap();
        assert_eq!(backfill.inboxes, 0);
        let sweep = service.sweep(MONTH, 100).await.unwrap();
        assert_eq!((sweep.inboxes, sweep.inboxes_unknown), (0, 0));
        assert!(classifier.asked.lock().unwrap().is_empty());

        // Back: the look finds the inbox, its backfill fills it, and the sweep
        // covers it again.
        seen(&pool, OWNER, chrono::Duration::zero()).await;
        let found = service.enrolled_inboxes(4).await.unwrap();
        let [inbox] = found.enrolled.as_slice() else {
            panic!("one inbox in the rollout, found {}", found.enrolled.len());
        };
        let backfill = service
            .backfill(inbox, MONTH, 4, DueDates::Read)
            .await
            .unwrap();
        assert_eq!(backfill.inboxes, 1);
        assert!(
            classifier
                .asked
                .lock()
                .unwrap()
                .contains(&OWNERS_OLDER_THREAD)
        );
        assert_eq!(service.sweep(MONTH, 100).await.unwrap().inboxes, 1);
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(
            path = "../../../../../crates/email/fixtures",
            scripts("email_focus", "email_focus_linked")
        )
    )]
    async fn a_linked_inbox_is_worked_while_the_person_reading_it_is_around(pool: Pool<Postgres>) {
        // Both in the rollout. The linked inbox's own owner has been away;
        // the person it is linked to was here an hour ago.
        insert_person(&pool, OWNER).await;
        insert_person(&pool, OTHER).await;
        seen(&pool, OWNER, chrono::Duration::hours(1)).await;
        seen(&pool, OTHER, chrono::Duration::days(8)).await;
        let rollout = Enrolled([person(OWNER), person(OTHER)].into_iter().collect());
        let classifier = RecordingClassifier::new(Duration::ZERO);
        let service = service(&pool, rollout, WEEK, &classifier);

        assert!(matches!(
            service.classify_thread(OTHERS_THREAD).await.unwrap(),
            ClassifyOutcome::Classified(_)
        ));
        let mut found: Vec<Uuid> = service
            .enrolled_inboxes(4)
            .await
            .unwrap()
            .enrolled
            .iter()
            .map(|inbox| inbox.link_id)
            .collect();
        found.sort();
        assert_eq!(found, vec![OWNERS_LINK, OTHERS_LINK]);
    }
}
