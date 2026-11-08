use chrono::TimeDelta;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::json;

use super::*;
use crate::domain::ports::ScheduledActionRepo;
use crate::outbound::pg_scheduled_action_repo::test::{
    USER_A, USER_B, insert_user, sample_action, test_repo, user_owner,
};

fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap()
}

fn starter(key: &str) -> CheckedSuggestion {
    CheckedSuggestion {
        surface: Surface::Email,
        reason: "You get a lot of mail.".to_owned(),
        keep_probability: 0.7,
        pick: SuggestionPick::Starter {
            key: key.to_owned(),
            knobs: serde_json::from_value(json!({ "fyiTag": "Info" })).unwrap(),
        },
    }
}

fn request(title: &str) -> CheckedSuggestion {
    CheckedSuggestion {
        surface: Surface::Crm,
        reason: "Suppliers write every week.".to_owned(),
        keep_probability: 0.3,
        pick: SuggestionPick::Request {
            title: title.to_owned(),
            request: "Every Friday, list the deliveries suppliers confirmed.".to_owned(),
        },
    }
}

fn picks(suggestions: &[RoutineSuggestion]) -> Vec<SuggestionPick> {
    suggestions
        .iter()
        .map(|suggestion| suggestion.pick.clone())
        .collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn one_generation_runs_at_a_time_and_a_dead_one_is_taken_over(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgSuggestionRepo::new(pool);
    let owner = user(USER_A);
    let now = Utc::now();
    let (first, second, third) = (Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7());

    assert!(
        repo.claim(&owner, first, now, now - TimeDelta::minutes(5))
            .await
            .unwrap()
    );
    assert!(
        !repo
            .claim(&owner, second, now, now - TimeDelta::minutes(5))
            .await
            .unwrap()
    );
    // Five minutes on, the first is presumed dead.
    let later = now + TimeDelta::minutes(6);
    assert!(
        repo.claim(&owner, third, later, later - TimeDelta::minutes(5))
            .await
            .unwrap()
    );

    // The first's late result is dropped; the third's lands.
    assert!(
        !repo
            .complete(&owner, first, "a", &[starter("inbox")], later)
            .await
            .unwrap()
    );
    assert!(repo.open(&owner).await.unwrap().is_empty());
    assert!(
        repo.complete(&owner, third, "b", &[starter("inbox")], later)
            .await
            .unwrap()
    );
    let stored = repo.generation(&owner).await.unwrap().unwrap();
    assert_eq!(stored.status, GenerationStatus::Ready);
    assert_eq!(stored.inputs.as_deref(), Some("b"));
    assert_eq!(
        picks(&repo.open(&owner).await.unwrap()),
        picks_of(&[starter("inbox")])
    );

    // A ready generation can be claimed again, and failing it keeps the
    // suggestions shown.
    let fourth = Uuid::now_v7();
    assert!(
        repo.claim(&owner, fourth, later, later - TimeDelta::minutes(5))
            .await
            .unwrap()
    );
    repo.fail(&owner, fourth).await.unwrap();
    assert_eq!(
        repo.generation(&owner).await.unwrap().unwrap().status,
        GenerationStatus::Failed
    );
    assert_eq!(repo.open(&owner).await.unwrap().len(), 1);
}

fn picks_of(suggestions: &[CheckedSuggestion]) -> Vec<SuggestionPick> {
    suggestions
        .iter()
        .map(|suggestion| suggestion.pick.clone())
        .collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_new_generation_replaces_open_suggestions_but_keeps_dismissed_and_accepted(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let repo = PgSuggestionRepo::new(pool.clone());
    let actions = test_repo(pool);
    let owner = user(USER_A);
    let now = Utc::now();
    let first = Uuid::now_v7();
    repo.claim(&owner, first, now, now).await.unwrap();
    repo.complete(
        &owner,
        first,
        "a",
        &[starter("inbox"), starter("triage"), request("Digest")],
        now,
    )
    .await
    .unwrap();
    let open = repo.open(&owner).await.unwrap();
    assert_eq!(open.len(), 3);
    assert_eq!(open[0].surface, Surface::Email);

    // Not interested in the first; the second is saved as a routine.
    assert!(repo.dismiss(&owner, open[0].id).await.unwrap());
    let mut saved = sample_action(user_owner(USER_A), "Triage new tasks");
    saved.suggestion_id = Some(open[1].id);
    let saved = actions.create_action(saved).await.unwrap();
    assert_eq!(saved.suggestion_id, Some(open[1].id));
    // Another person can't dismiss it, and pointing their routine at it
    // doesn't take it.
    assert!(!repo.dismiss(&user(USER_B), open[2].id).await.unwrap());
    let mut theirs = sample_action(user_owner(USER_B), "Digest");
    theirs.suggestion_id = Some(open[2].id);
    actions.create_action(theirs).await.unwrap();
    assert_eq!(
        picks(&repo.open(&owner).await.unwrap()),
        picks_of(&[request("Digest")])
    );
    assert_eq!(
        repo.dismissed(&owner).await.unwrap(),
        picks_of(&[starter("inbox")])
    );

    let second = Uuid::now_v7();
    repo.claim(&owner, second, now, now).await.unwrap();
    repo.complete(&owner, second, "b", &[starter("email_tags")], now)
        .await
        .unwrap();
    assert_eq!(
        picks(&repo.open(&owner).await.unwrap()),
        picks_of(&[starter("email_tags")])
    );
    // The dismissal and the saved routine's suggestion survive.
    assert_eq!(
        repo.dismissed(&owner).await.unwrap(),
        picks_of(&[starter("inbox")])
    );
    let reread = actions
        .get_action(&saved.id.unwrap())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(reread.suggestion_id, Some(open[1].id));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn sweeps_take_people_who_read_recently_each_once_per_interval(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let repo = PgSuggestionRepo::new(pool);
    let (a, b) = (user(USER_A), user(USER_B));
    let now = Utc::now();
    let active_since = now - TimeDelta::days(14);
    let checked_before = now - TimeDelta::hours(1);

    // Nobody read their suggestions: nobody to look at.
    assert!(
        repo.take_checks(active_since, checked_before, now, 10)
            .await
            .unwrap()
            .is_empty()
    );
    // A first read leaves a pending generation, and reading again keeps it.
    repo.seen(&a, now).await.unwrap();
    repo.seen(&a, now).await.unwrap();
    let pending = repo.generation(&a).await.unwrap().unwrap();
    assert_eq!(pending.status, GenerationStatus::Pending);
    // B read a month ago.
    repo.seen(&b, now - TimeDelta::days(30)).await.unwrap();

    // Two sweeps at once take different people: A goes to one of them.
    let (first, second) = tokio::join!(
        repo.take_checks(active_since, checked_before, now, 10),
        repo.take_checks(active_since, checked_before, now, 10),
    );
    let mut taken = [first.unwrap(), second.unwrap()].concat();
    taken.sort_by(|x, y| x.as_ref().cmp(y.as_ref()));
    assert_eq!(taken, [a.clone()]);
    // Looked at, so not again within the interval.
    assert!(
        repo.take_checks(active_since, checked_before, now, 10)
            .await
            .unwrap()
            .is_empty()
    );
    let later = now + TimeDelta::hours(2);
    assert_eq!(
        repo.take_checks(active_since, later - TimeDelta::hours(1), later, 10)
            .await
            .unwrap(),
        [a.clone()]
    );
    // A pending generation can be claimed.
    assert!(
        repo.claim(&a, Uuid::now_v7(), now, now - TimeDelta::minutes(5))
            .await
            .unwrap()
    );
}
