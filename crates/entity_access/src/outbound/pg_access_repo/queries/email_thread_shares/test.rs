use super::*;
use crate::outbound::pg_access_repo::queries::{
    source_list_oracle,
    test_viewers::{assert_matrix_agrees, matrix_viewers, user_in_channel, user_in_team},
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::{BTreeSet, HashSet};

const VIEWER: &str = "macro|viewer@corp.test";
const OTHER: &str = "macro|other@corp.test";

fn user(s: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(s.to_string()).unwrap()
}

async fn insert_link(pool: &PgPool, macro_id: &str, address: &str) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
           VALUES ($1, $2, $2, $3, 'GMAIL')"#,
        id,
        macro_id,
        address,
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn insert_thread(pool: &PgPool, link_id: Uuid) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_threads (id, link_id) VALUES ($1, $2)",
        id,
        link_id
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn grant(pool: &PgPool, entity_id: Uuid, entity_type: &str, source_id: &str, level: &str) {
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
           VALUES ($1, $2, $3, 'user', $4::text::"AccessLevel")"#,
        entity_id,
        entity_type,
        source_id,
        level,
    )
    .execute(pool)
    .await
    .unwrap();
}

struct Fixture {
    own_link: Uuid,
    other_link: Uuid,
    direct: Uuid,
    via_channel: Uuid,
    via_team: Uuid,
}

/// The viewer is in one channel and one team; threads in another inbox are
/// shared with the viewer, that channel and that team.
async fn fixture(pool: &PgPool) -> Fixture {
    let own_link = insert_link(pool, VIEWER, "viewer@corp.test").await;
    let other_link = insert_link(pool, OTHER, "other@corp.test").await;
    let channel = Uuid::now_v7();
    user_in_channel(pool, VIEWER, channel).await.unwrap();
    let team = Uuid::now_v7();
    user_in_team(pool, VIEWER, team).await.unwrap();

    let direct = insert_thread(pool, other_link).await;
    grant(pool, direct, "email_thread", VIEWER, "view").await;
    let via_channel = insert_thread(pool, other_link).await;
    grant(
        pool,
        via_channel,
        "email_thread",
        &channel.to_string(),
        "comment",
    )
    .await;
    let via_team = insert_thread(pool, other_link).await;
    grant(pool, via_team, "email_thread", &team.to_string(), "view").await;

    // The viewer's own thread carries an owner grant to them.
    let own = insert_thread(pool, own_link).await;
    grant(pool, own, "email_thread", VIEWER, "owner").await;
    // Shared with someone else, and a document shared with the viewer.
    let elsewhere = insert_thread(pool, other_link).await;
    grant(pool, elsewhere, "email_thread", OTHER, "owner").await;
    grant(pool, Uuid::now_v7(), "document", VIEWER, "view").await;

    Fixture {
        own_link,
        other_link,
        direct,
        via_channel,
        via_team,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn threads_granted_to_any_source_outside_own_inboxes(pool: PgPool) -> anyhow::Result<()> {
    let fixture = fixture(&pool).await;

    let shared = shared_email_threads(&pool, &user(VIEWER), &[fixture.own_link], &[], 100).await?;

    let got: HashSet<SharedEmailThread> = shared.into_iter().collect();
    let want: HashSet<SharedEmailThread> = [fixture.direct, fixture.via_channel, fixture.via_team]
        .into_iter()
        .map(|thread_id| SharedEmailThread {
            thread_id,
            link_id: fixture.other_link,
        })
        .collect();
    assert_eq!(got, want);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn requested_threads_narrow_the_shares(pool: PgPool) -> anyhow::Result<()> {
    let fixture = fixture(&pool).await;

    let shared = shared_email_threads(
        &pool,
        &user(VIEWER),
        &[fixture.own_link],
        &[fixture.via_channel, Uuid::now_v7()],
        100,
    )
    .await?;

    assert_eq!(
        shared,
        vec![SharedEmailThread {
            thread_id: fixture.via_channel,
            link_id: fixture.other_link,
        }]
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_limit_bounds_the_shares(pool: PgPool) -> anyhow::Result<()> {
    let fixture = fixture(&pool).await;

    let shared = shared_email_threads(&pool, &user(VIEWER), &[fixture.own_link], &[], 2).await?;

    assert_eq!(shared.len(), 2);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_caller_without_grants_shares_nothing(pool: PgPool) -> anyhow::Result<()> {
    fixture(&pool).await;

    let shared =
        shared_email_threads(&pool, &user("macro|stranger@corp.test"), &[], &[], 100).await?;

    assert!(shared.is_empty());
    Ok(())
}

/// Every user of the viewer matrix gets the threads the source-list form
/// returned for their `get_user_source_ids`, with and without their own
/// inboxes and requested threads left out.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../fixtures",
        scripts("viewer_matrix", "viewer_matrix_thread")
    )
)]
async fn shared_email_threads_match_the_source_list_form(pool: PgPool) -> anyhow::Result<()> {
    let viewers = matrix_viewers(&pool).await?;
    // Email search runs for signed-in users only.
    let users: Vec<_> = viewers
        .iter()
        .filter(|viewer| viewer.user_id().is_some())
        .cloned()
        .collect();
    // The inbox holding every granted thread.
    let granted_inbox = sqlx::query_scalar!(
        r#"SELECT id FROM email_links WHERE macro_id = 'macro|matrix-other@example.com'"#
    )
    .fetch_all(&pool)
    .await?;
    let threads = sqlx::query_scalar!(r#"SELECT id FROM email_threads ORDER BY id"#)
        .fetch_all(&pool)
        .await?;
    let cases: [(&str, &[Uuid], &[Uuid]); 3] = [
        ("every share", &[], &[]),
        ("outside the granted inbox", &granted_inbox, &[]),
        (
            "among the first half of the threads",
            &[],
            &threads[..threads.len() / 2],
        ),
    ];
    let labels: Vec<_> = cases.iter().map(|(label, _, _)| *label).collect();

    assert_matrix_agrees(&users, &labels, async |viewer, label| {
        let (_, own_links, requested) = cases
            .iter()
            .find(|(case, _, _)| case == label)
            .ok_or_else(|| anyhow::anyhow!("no case {label}"))?;
        let user_id = viewer
            .user_id()
            .ok_or_else(|| anyhow::anyhow!("{} is not a user", viewer.label))?;
        let old = source_list_oracle::shared_email_threads(
            &pool,
            &viewer.sources,
            own_links,
            requested,
            1000,
        )
        .await?;
        let new = shared_email_threads(&pool, &user_id, own_links, requested, 1000).await?;
        Ok((
            old.into_iter()
                .map(|thread| (thread.thread_id, thread.link_id))
                .collect::<BTreeSet<_>>(),
            new.into_iter()
                .map(|thread| (thread.thread_id, thread.link_id))
                .collect::<BTreeSet<_>>(),
        ))
    })
    .await
}

const THIRD: &str = "macro|third@corp.test";

async fn insert_user(pool: &PgPool, user_id: &str) {
    let macro_user_id = Uuid::now_v7();
    let email = user_id.trim_start_matches("macro|");
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $3, $2)",
        macro_user_id,
        user_id,
        email,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        user_id,
        email,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_project(pool: &PgPool, owner_id: &str) -> String {
    let id = Uuid::now_v7().to_string();
    sqlx::query!(
        r#"INSERT INTO "Project" (id, name, "userId") VALUES ($1, 'Folder', $2)"#,
        id,
        owner_id,
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn insert_thread_in(pool: &PgPool, link_id: Uuid, project_id: &str) -> Uuid {
    let id = insert_thread(pool, link_id).await;
    sqlx::query!(
        "UPDATE email_threads SET project_id = $2 WHERE id = $1",
        id,
        project_id
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn revoke(pool: &PgPool, entity_id: &str, source_id: &str) {
    sqlx::query!(
        "DELETE FROM entity_access WHERE entity_id::text = $1 AND source_id = $2",
        entity_id,
        source_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

struct Folder {
    project: String,
    other_project: String,
    viewer_link: Uuid,
    third_link: Uuid,
    own_in_folder: Uuid,
    teammate_in_folder: Uuid,
    teammate_shared_elsewhere: Uuid,
    channel: Uuid,
}

/// A folder owned by OTHER and shared with a channel the viewer is in.
/// It holds one of the viewer's threads and one of OTHER's. A second,
/// unshared folder holds a thread of OTHER's that a thread grant shares with
/// the viewer. THIRD has an inbox but no grant.
async fn folder(pool: &PgPool) -> Folder {
    insert_user(pool, OTHER).await;
    let viewer_link = insert_link(pool, VIEWER, "viewer@corp.test").await;
    let other_link = insert_link(pool, OTHER, "other@corp.test").await;
    let third_link = insert_link(pool, THIRD, "third@corp.test").await;
    let project = insert_project(pool, OTHER).await;
    let other_project = insert_project(pool, OTHER).await;
    let channel = Uuid::now_v7();
    user_in_channel(pool, VIEWER, channel).await.unwrap();
    grant(
        pool,
        project.parse().unwrap(),
        "project",
        &channel.to_string(),
        "view",
    )
    .await;

    let own_in_folder = insert_thread_in(pool, viewer_link, &project).await;
    let teammate_in_folder = insert_thread_in(pool, other_link, &project).await;
    insert_thread(pool, other_link).await;
    let teammate_shared_elsewhere = insert_thread_in(pool, other_link, &other_project).await;
    grant(
        pool,
        teammate_shared_elsewhere,
        "email_thread",
        VIEWER,
        "view",
    )
    .await;

    Folder {
        project,
        other_project,
        viewer_link,
        third_link,
        own_in_folder,
        teammate_in_folder,
        teammate_shared_elsewhere,
        channel,
    }
}

fn ids(threads: Vec<SharedEmailThread>) -> HashSet<Uuid> {
    threads.into_iter().map(|thread| thread.thread_id).collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_teammate_with_the_folder_grant_reaches_every_thread_in_it(
    pool: PgPool,
) -> anyhow::Result<()> {
    let f = folder(&pool).await;
    let viewer = user(VIEWER);

    let threads = project_email_threads(
        &pool,
        &viewer,
        &[f.viewer_link],
        &[f.project.clone()],
        &[],
        true,
        false,
        100,
    )
    .await?;
    assert_eq!(
        ids(threads),
        HashSet::from([f.own_in_folder, f.teammate_in_folder])
    );

    let shared = project_shared_email_threads(
        &pool,
        &viewer,
        &[f.viewer_link],
        &[
            f.own_in_folder,
            f.teammate_in_folder,
            f.teammate_shared_elsewhere,
        ],
    )
    .await?;
    assert_eq!(ids(shared), HashSet::from([f.teammate_in_folder]));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_viewer_without_the_folder_grant_reaches_none_of_its_threads(
    pool: PgPool,
) -> anyhow::Result<()> {
    let f = folder(&pool).await;
    let viewer = user(THIRD);

    let threads = project_email_threads(
        &pool,
        &viewer,
        &[f.third_link],
        &[f.project.clone()],
        &[],
        true,
        true,
        100,
    )
    .await?;
    assert!(threads.is_empty());
    let shared = project_shared_email_threads(
        &pool,
        &viewer,
        &[f.third_link],
        &[f.own_in_folder, f.teammate_in_folder],
    )
    .await?;
    assert!(shared.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_revoked_folder_grant_reaches_nothing_beyond_the_viewers_own_threads(
    pool: PgPool,
) -> anyhow::Result<()> {
    let f = folder(&pool).await;
    let viewer = user(VIEWER);
    revoke(&pool, &f.project, &f.channel.to_string()).await;

    let threads = project_email_threads(
        &pool,
        &viewer,
        &[f.viewer_link],
        &[f.project.clone()],
        &[],
        true,
        false,
        100,
    )
    .await?;
    assert_eq!(ids(threads), HashSet::from([f.own_in_folder]));
    let shared =
        project_shared_email_threads(&pool, &viewer, &[f.viewer_link], &[f.teammate_in_folder])
            .await?;
    assert!(shared.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn shared_only_leaves_out_own_threads_and_thread_shares_add_granted_threads(
    pool: PgPool,
) -> anyhow::Result<()> {
    let f = folder(&pool).await;
    let viewer = user(VIEWER);
    let both = [f.project.clone(), f.other_project.clone()];

    let only = project_email_threads(
        &pool,
        &viewer,
        &[f.viewer_link],
        &both,
        &[],
        false,
        true,
        100,
    )
    .await?;
    assert_eq!(
        ids(only),
        HashSet::from([f.teammate_in_folder, f.teammate_shared_elsewhere])
    );
    let exclude = project_email_threads(
        &pool,
        &viewer,
        &[f.viewer_link],
        &both,
        &[],
        true,
        false,
        100,
    )
    .await?;
    assert_eq!(
        ids(exclude),
        HashSet::from([f.own_in_folder, f.teammate_in_folder])
    );
    let capped =
        project_email_threads(&pool, &viewer, &[f.viewer_link], &both, &[], true, true, 1).await?;
    assert_eq!(capped.len(), 1);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn requested_threads_are_kept_however_full_their_folder(pool: PgPool) -> anyhow::Result<()> {
    let f = folder(&pool).await;
    let viewer = user(VIEWER);
    let project = [f.project.clone()];

    for requested in [f.own_in_folder, f.teammate_in_folder] {
        let threads = project_email_threads(
            &pool,
            &viewer,
            &[f.viewer_link],
            &project,
            &[requested],
            true,
            false,
            1,
        )
        .await?;
        assert_eq!(ids(threads), HashSet::from([requested]));
    }
    let elsewhere = project_email_threads(
        &pool,
        &viewer,
        &[f.viewer_link],
        &project,
        &[f.teammate_shared_elsewhere],
        true,
        true,
        100,
    )
    .await?;
    assert!(elsewhere.is_empty());
    Ok(())
}

/// The viewer matrix's folders, each granted to one source and holding one
/// thread, and one folder without a grant holding the rest of matrix-other's
/// inbox: a thread shared with each source by a thread grant, one shared with
/// every source and one with no grant. Returns every folder and every thread
/// in one.
async fn matrix_folders(pool: &PgPool) -> anyhow::Result<(Vec<String>, Vec<Uuid>)> {
    let ungranted = insert_project(pool, "macro|matrix-other@example.com").await;
    sqlx::query!(
        r#"UPDATE email_threads SET project_id = $1
           WHERE project_id IS NULL AND link_id IN (
               SELECT id FROM email_links WHERE macro_id = 'macro|matrix-other@example.com')"#,
        ungranted,
    )
    .execute(pool)
    .await?;
    let projects = sqlx::query_scalar!(
        r#"SELECT DISTINCT project_id AS "project_id!" FROM email_threads
           WHERE project_id IS NOT NULL ORDER BY 1"#
    )
    .fetch_all(pool)
    .await?;
    let threads = sqlx::query_scalar!(
        r#"SELECT id FROM email_threads WHERE project_id IS NOT NULL ORDER BY id"#
    )
    .fetch_all(pool)
    .await?;
    Ok((projects, threads))
}

fn pairs(threads: Vec<SharedEmailThread>) -> BTreeSet<(Uuid, Uuid)> {
    threads
        .into_iter()
        .map(|thread| (thread.thread_id, thread.link_id))
        .collect()
}

/// Every user of the viewer matrix gets the folder threads the source-list
/// form returned for their sources: through a folder grant, through a thread
/// grant in a folder not granted to them, and narrowed to requested threads.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../fixtures",
        scripts("viewer_matrix", "viewer_matrix_thread")
    )
)]
async fn project_email_threads_match_the_source_list_form(pool: PgPool) -> anyhow::Result<()> {
    let viewers = matrix_viewers(&pool).await?;
    // Email search runs for signed-in users only.
    let users: Vec<_> = viewers
        .iter()
        .filter(|viewer| viewer.user_id().is_some())
        .cloned()
        .collect();
    let (projects, threads) = matrix_folders(&pool).await?;
    let half = &threads[..threads.len() / 2];
    let cases: [(&str, &[Uuid], bool); 3] = [
        ("folder and thread grants", &[], true),
        ("folder grants only", &[], false),
        ("among the first half of the threads", half, true),
    ];
    let labels: Vec<_> = cases.iter().map(|(label, _, _)| *label).collect();

    assert_matrix_agrees(&users, &labels, async |viewer, label| {
        let (_, requested, include_thread_shares) = cases
            .iter()
            .find(|(case, _, _)| case == label)
            .ok_or_else(|| anyhow::anyhow!("no case {label}"))?;
        let user_id = viewer
            .user_id()
            .ok_or_else(|| anyhow::anyhow!("{} is not a user", viewer.label))?;
        let old = source_list_oracle::project_email_threads(
            &pool,
            &viewer.sources,
            &[],
            &projects,
            requested,
            true,
            *include_thread_shares,
            1000,
        )
        .await?;
        let new = project_email_threads(
            &pool,
            &user_id,
            &[],
            &projects,
            requested,
            true,
            *include_thread_shares,
            1000,
        )
        .await?;
        Ok((pairs(old), pairs(new)))
    })
    .await
}

/// Every user of the viewer matrix gets the folder-shared threads the
/// source-list form returned for their sources.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../fixtures",
        scripts("viewer_matrix", "viewer_matrix_thread")
    )
)]
async fn project_shared_email_threads_match_the_source_list_form(
    pool: PgPool,
) -> anyhow::Result<()> {
    let viewers = matrix_viewers(&pool).await?;
    // Email search runs for signed-in users only.
    let users: Vec<_> = viewers
        .iter()
        .filter(|viewer| viewer.user_id().is_some())
        .cloned()
        .collect();
    let (_, threads) = matrix_folders(&pool).await?;
    let cases: [(&str, &[Uuid]); 2] = [
        ("every folder thread", &threads),
        ("the first half", &threads[..threads.len() / 2]),
    ];
    let labels: Vec<_> = cases.iter().map(|(label, _)| *label).collect();

    assert_matrix_agrees(&users, &labels, async |viewer, label| {
        let (_, thread_ids) = cases
            .iter()
            .find(|(case, _)| case == label)
            .ok_or_else(|| anyhow::anyhow!("no case {label}"))?;
        let user_id = viewer
            .user_id()
            .ok_or_else(|| anyhow::anyhow!("{} is not a user", viewer.label))?;
        let old = source_list_oracle::project_shared_email_threads(
            &pool,
            &viewer.sources,
            &[],
            thread_ids,
        )
        .await?;
        let new = project_shared_email_threads(&pool, &user_id, &[], thread_ids).await?;
        Ok((pairs(old), pairs(new)))
    })
    .await
}
