//! The team's claim on each Notion object, against the real ledger: one
//! teammate writes an object for the team, and the others link to it.

use std::time::Duration;

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use sqlx::PgPool;

use super::*;
use crate::domain::models::{ImportKind, ImportStatus, NotionJob, TEAMMATE_STOPPED};
use crate::domain::ports::{ImportRepo, NotionRunRepo};

const ROADMAP: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

async fn member(pool: &PgPool, label: &str, team: Uuid) -> MacroUserIdStr<'static> {
    let id = Uuid::now_v7();
    let email = format!("{label}@example.com");
    let user_id = format!("macro|{email}");
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $3, $2)",
        id,
        label,
        email,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO \"User\" (id, email, macro_user_id) VALUES ($1, $2, $3)",
        user_id,
        email,
        id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Claims', $2) ON CONFLICT (id) DO NOTHING",
        team,
        user_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, 'member')",
        user_id,
        team,
    )
    .execute(pool)
    .await
    .unwrap();
    MacroUserIdStr::parse_from_str(&user_id)
        .unwrap()
        .into_owned()
}

/// `user`'s one-page plan of the Roadmap, staged.
async fn roadmap_plan(repo: &PgImportRepo, user: &MacroUserIdStr<'static>) -> Uuid {
    let staged = repo
        .replace_plan(
            user,
            ImportSource::Notion,
            &[PlanRow {
                kind: ImportKind::Page,
                foreign_id: ROADMAP.to_string(),
                parent_foreign_id: None,
                metadata: serde_json::json!({
                    "title": "Roadmap", "url": null, "summary": null,
                    "plan": { "decision": "copy", "path": [], "shared": true, "shareable": true }
                }),
            }],
        )
        .await
        .unwrap();
    staged[0].id
}

/// `user`'s run, writing, held by a live process.
async fn writing(repo: &PgImportRepo, user: &MacroUserIdStr<'static>, lease: Duration) {
    repo.start_run(user, ImportSource::Notion, &[])
        .await
        .unwrap();
    repo.transition_run(
        user,
        ImportSource::Notion,
        &[RunStatus::Running],
        RunStatus::Importing,
        None,
    )
    .await
    .unwrap();
    let job = NotionJob::Plan {
        scope: import_notion::domain::model::ImportScope::Everything,
        sharing: crate::domain::models::NotionSharing::Team,
    };
    assert!(
        repo.take_run(user, Uuid::now_v7(), lease, &job)
            .await
            .unwrap()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_the_first_teammate_to_start_writing_holds_the_teams_claim(pool: PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let team = Uuid::now_v7();
    let ana = member(&pool, "claim-ana", team).await;
    let bo = member(&pool, "claim-bo", team).await;
    let anas = roadmap_plan(&repo, &ana).await;
    let bos = roadmap_plan(&repo, &bo).await;

    let first = repo
        .claim_importing(&ana, &[anas], &[anas], Some(team))
        .await
        .unwrap();
    let second = repo
        .claim_importing(&bo, &[bos], &[bos], Some(team))
        .await
        .unwrap();

    assert_eq!(first[0].status, ImportStatus::Importing);
    assert_eq!(first[0].team_id, Some(team), "Ana holds the claim");
    assert_eq!(second[0].status, ImportStatus::Importing);
    assert_eq!(second[0].team_id, None, "Bo writes nothing for the team");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_private_object_takes_no_claim(pool: PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let team = Uuid::now_v7();
    let ana = member(&pool, "private-ana", team).await;
    let anas = roadmap_plan(&repo, &ana).await;

    let claimed = repo
        .claim_importing(&ana, &[anas], &[], Some(team))
        .await
        .unwrap();

    assert_eq!(claimed[0].team_id, None);
    assert_eq!(
        repo.claim_team_object(&ana, anas, team, false)
            .await
            .unwrap(),
        TeamClaim::Free
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_teammate_waits_on_the_live_holder_and_is_linked_once_it_is_imported(pool: PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let team = Uuid::now_v7();
    let ana = member(&pool, "wait-ana", team).await;
    let bo = member(&pool, "wait-bo", team).await;
    let anas = roadmap_plan(&repo, &ana).await;
    let bos = roadmap_plan(&repo, &bo).await;
    writing(&repo, &ana, Duration::from_secs(90)).await;
    repo.claim_importing(&ana, &[anas], &[anas], Some(team))
        .await
        .unwrap();
    repo.claim_importing(&bo, &[bos], &[bos], Some(team))
        .await
        .unwrap();

    let claim = repo.claim_team_object(&bo, bos, team, true).await.unwrap();
    assert_eq!(claim, TeamClaim::Waiting { holder: anas });
    assert!(repo.wait_on(&bo, bos, anas).await.unwrap());
    repo.mark_imported(&ana, anas, "doc-roadmap", "md", None)
        .await
        .unwrap();

    let anas = repo.get(&ana, anas).await.unwrap().unwrap();
    assert_eq!(anas.team_id, Some(team), "the claim stays with the copy");
    let bos = repo.get(&bo, bos).await.unwrap().unwrap();
    assert_eq!(bos.status, ImportStatus::Imported);
    assert_eq!(bos.entity_id.as_deref(), Some("doc-roadmap"));
    assert_eq!(bos.waiting_on, None);
    assert_eq!(bos.team_id, None);
    assert_eq!(
        repo.team_copies(&bo, &[ROADMAP.to_string()])
            .await
            .unwrap()
            .len(),
        1,
        "Ana's copy is the team's"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_finished_copy_is_linked_and_a_stopped_holder_is_taken_over(pool: PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let team = Uuid::now_v7();
    let ana = member(&pool, "over-ana", team).await;
    let bo = member(&pool, "over-bo", team).await;
    let cy = member(&pool, "over-cy", team).await;
    let anas = roadmap_plan(&repo, &ana).await;
    let bos = roadmap_plan(&repo, &bo).await;
    let cys = roadmap_plan(&repo, &cy).await;
    // Ana's process died: her run's lease lapsed with her row still claimed.
    writing(&repo, &ana, Duration::ZERO).await;
    repo.claim_importing(&ana, &[anas], &[anas], Some(team))
        .await
        .unwrap();
    repo.claim_importing(&bo, &[bos], &[bos], Some(team))
        .await
        .unwrap();
    repo.claim_importing(&cy, &[cys], &[cys], Some(team))
        .await
        .unwrap();
    // Cy was already waiting on Ana.
    assert!(repo.wait_on(&cy, cys, anas).await.unwrap());

    let claim = repo.claim_team_object(&bo, bos, team, true).await.unwrap();

    assert_eq!(claim, TeamClaim::Held, "Bo takes the stopped claim over");
    assert_eq!(repo.get(&ana, anas).await.unwrap().unwrap().team_id, None);
    assert_eq!(
        repo.get(&cy, cys).await.unwrap().unwrap().waiting_on,
        Some(bos),
        "Cy now waits on Bo"
    );
    // Ana's write, resumed while Bo's is running, finds her claim gone and
    // waits on Bo instead of writing a second copy.
    writing(&repo, &bo, Duration::from_secs(90)).await;
    assert_eq!(
        repo.claim_team_object(&ana, anas, team, true)
            .await
            .unwrap(),
        TeamClaim::Waiting { holder: bos }
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_teammate_linking_a_finished_copy_never_claims_it(pool: PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let team = Uuid::now_v7();
    let ana = member(&pool, "link-ana", team).await;
    let bo = member(&pool, "link-bo", team).await;
    let anas = roadmap_plan(&repo, &ana).await;
    let bos = roadmap_plan(&repo, &bo).await;
    repo.claim_importing(&ana, &[anas], &[anas], Some(team))
        .await
        .unwrap();
    repo.mark_imported(&ana, anas, "doc-roadmap", "md", None)
        .await
        .unwrap();
    repo.claim_importing(&bo, &[bos], &[bos], Some(team))
        .await
        .unwrap();

    assert_eq!(
        repo.claim_team_object(&bo, bos, team, false).await.unwrap(),
        TeamClaim::Linked {
            entity_id: "doc-roadmap".to_string(),
            entity_type: "md".to_string(),
        }
    );
    assert!(
        !repo.wait_on(&bo, bos, anas).await.unwrap(),
        "nothing to wait for once it is imported"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_holder_that_fails_gives_up_its_claim_and_releases_its_waiters(pool: PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let team = Uuid::now_v7();
    let ana = member(&pool, "fail-ana", team).await;
    let bo = member(&pool, "fail-bo", team).await;
    let anas = roadmap_plan(&repo, &ana).await;
    let bos = roadmap_plan(&repo, &bo).await;
    repo.claim_importing(&ana, &[anas], &[anas], Some(team))
        .await
        .unwrap();
    repo.claim_importing(&bo, &[bos], &[bos], Some(team))
        .await
        .unwrap();
    assert!(repo.wait_on(&bo, bos, anas).await.unwrap());

    assert!(
        repo.mark_import_failed(&ana, anas, "Notion request failed")
            .await
            .unwrap()
    );

    let anas = repo.get(&ana, anas).await.unwrap().unwrap();
    assert_eq!(anas.status, ImportStatus::Staged);
    assert_eq!(anas.team_id, None);
    let bos = repo.get(&bo, bos).await.unwrap().unwrap();
    assert_eq!(bos.status, ImportStatus::Staged);
    assert_eq!(bos.waiting_on, None);
    assert_eq!(bos.last_error.as_deref(), Some(TEAMMATE_STOPPED));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_waiting_row_outlives_its_own_write_until_the_holder_settles(pool: PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let team = Uuid::now_v7();
    let ana = member(&pool, "settle-ana", team).await;
    let bo = member(&pool, "settle-bo", team).await;
    let anas = roadmap_plan(&repo, &ana).await;
    let bos = roadmap_plan(&repo, &bo).await;
    repo.claim_importing(&ana, &[anas], &[anas], Some(team))
        .await
        .unwrap();
    repo.claim_importing(&bo, &[bos], &[bos], Some(team))
        .await
        .unwrap();
    assert!(repo.wait_on(&bo, bos, anas).await.unwrap());

    // Bo's run is over; his row waits on Ana's, which is still being written.
    assert_eq!(repo.settle_importing(&bo, "stopped").await.unwrap(), 0);
    // Ana's run is over too, without her row written: both go back.
    assert_eq!(repo.settle_importing(&ana, "stopped").await.unwrap(), 1);

    let bos = repo.get(&bo, bos).await.unwrap().unwrap();
    assert_eq!(bos.status, ImportStatus::Staged);
    assert_eq!(bos.last_error.as_deref(), Some(TEAMMATE_STOPPED));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_owners_sharing_changes_are_recorded_on_their_staged_rows(pool: PgPool) {
    let repo = PgImportRepo::new(pool.clone());
    let team = Uuid::now_v7();
    let ana = member(&pool, "share-ana", team).await;
    let anas = roadmap_plan(&repo, &ana).await;

    assert_eq!(repo.set_plan_sharing(&ana, &[], &[anas]).await.unwrap(), 1);
    let row = repo.get(&ana, anas).await.unwrap().unwrap();
    assert_eq!(row.metadata["plan"]["shared"], false);
    assert_eq!(row.metadata["title"], "Roadmap");

    assert_eq!(repo.set_plan_sharing(&ana, &[anas], &[]).await.unwrap(), 1);
    let row = repo.get(&ana, anas).await.unwrap().unwrap();
    assert_eq!(row.metadata["plan"]["shared"], true);
}
