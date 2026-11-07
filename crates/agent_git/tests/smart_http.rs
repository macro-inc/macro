//! Real `git` against the router on a random port, with Postgres and a temp
//! storage root.

use std::path::Path;
use std::process::Output;
use std::sync::Arc;

use agent_git::client::AgentGitClient;
use agent_git::domain::models::RepoLimits;
use agent_git::domain::service::{AgentGitAdapters, AgentGitServiceImpl};
use agent_git::domain::template::WORKSPACE_TEMPLATE;
use agent_git::inbound::http::{AgentGitRouterState, agent_git_router};
use agent_git::outbound::bare_repo_store::BareRepoStore;
use agent_git::outbound::git_http_backend::GitHttpBackend;
use agent_git::outbound::pg_repo_repository::PgRepoRepository;
use agent_git::outbound::push_rate_limiter::InMemoryPushRateLimiter;
use agent_git::outbound::repo_directories::RepoDirectories;
use agent_git::outbound::team_admins::TeamRepositoryAdmins;
use macro_authorization::{
    InternalAuthConfig, MacroAuthorizationServiceImpl, MacroAuthorizationState, NoBotAuthorizer,
    NoopMacroAuthJwtValidator, PgUserApiKeyAuthorizationRepo, PgUserApiKeyAuthorizer,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

const INTERNAL_API_KEY: &str = "internal-test-key";
const ADMIN_API_KEY: &str = "mak_admin-test-key";
const TEAM_ID: Uuid = Uuid::from_u128(0x0190_0000_0000_7000_8000_0000_0000_0001);

/// Users: two agents, a team admin with an API key, and a plain member.
async fn insert_fixtures(pool: &PgPool) {
    sqlx::raw_sql(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES
            ('01900000-0000-7000-8000-00000000000a', 'agent-a', 'agent-a@example.com', 'cus_a'),
            ('01900000-0000-7000-8000-00000000000b', 'agent-b', 'agent-b@example.com', 'cus_b'),
            ('01900000-0000-7000-8000-00000000000c', 'admin', 'admin@example.com', 'cus_c'),
            ('01900000-0000-7000-8000-00000000000d', 'member', 'member@example.com', 'cus_d');
        INSERT INTO "User" (id, email, macro_user_id) VALUES
            ('macro|agent-a@example.com', 'agent-a@example.com', '01900000-0000-7000-8000-00000000000a'),
            ('macro|agent-b@example.com', 'agent-b@example.com', '01900000-0000-7000-8000-00000000000b'),
            ('macro|admin@example.com', 'admin@example.com', '01900000-0000-7000-8000-00000000000c'),
            ('macro|member@example.com', 'member@example.com', '01900000-0000-7000-8000-00000000000d');
        INSERT INTO team (id, name, owner_id) VALUES
            ('01900000-0000-7000-8000-000000000001', 'Team', 'macro|admin@example.com');
        INSERT INTO team_user (user_id, team_id, team_role) VALUES
            ('macro|admin@example.com', '01900000-0000-7000-8000-000000000001', 'admin'),
            ('macro|member@example.com', '01900000-0000-7000-8000-000000000001', 'member');
        "#,
    )
    .execute(pool)
    .await
    .unwrap();

    sqlx::query!(
        r#"INSERT INTO "UserApiKey" (id, user_id, name, hash) VALUES ($1, $2, 'git', $3)"#,
        Uuid::now_v7(),
        "macro|admin@example.com",
        Sha256::digest(ADMIN_API_KEY.as_bytes()).to_vec(),
    )
    .execute(pool)
    .await
    .unwrap();
}

/// Serve the router on a random port; returns its base URL.
async fn start_server(pool: PgPool, storage_root: &Path, max_repo_size_bytes: u64) -> String {
    let directories = RepoDirectories::new(storage_root.to_path_buf());
    let service = AgentGitServiceImpl::new(
        AgentGitAdapters {
            repos: PgRepoRepository::new(pool.clone()),
            store: BareRepoStore::new(directories.clone()),
            admins: TeamRepositoryAdmins::new(teams::outbound::team_repo::TeamRepositoryImpl::new(
                pool.clone(),
            )),
            limiter: InMemoryPushRateLimiter::new(30),
            backend: GitHttpBackend::new(directories, tokio_util::task::TaskTracker::new()),
        },
        RepoLimits {
            max_repo_size_bytes,
        },
        WORKSPACE_TEMPLATE,
    );
    let authorization = MacroAuthorizationState::new(Arc::new(MacroAuthorizationServiceImpl::new(
        NoopMacroAuthJwtValidator,
        InternalAuthConfig {
            api_key: INTERNAL_API_KEY.to_owned(),
            default_user_id: None,
        },
        NoBotAuthorizer,
        PgUserApiKeyAuthorizer::new(PgUserApiKeyAuthorizationRepo::new(pool)),
    )));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    let app: axum::Router = agent_git_router(AgentGitRouterState::new(
        Arc::new(service),
        authorization,
        base_url.clone(),
    ));
    tokio::spawn(async move { axum::serve(listener, app).await });

    base_url
}

async fn git(directory: &Path, arguments: &[&str]) -> Output {
    tokio::process::Command::new("git")
        .args(arguments)
        .current_dir(directory)
        .env_clear()
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_AUTHOR_NAME", "Agent")
        .env("GIT_AUTHOR_EMAIL", "agent@example.com")
        .env("GIT_COMMITTER_NAME", "Agent")
        .env("GIT_COMMITTER_EMAIL", "agent@example.com")
        .output()
        .await
        .unwrap()
}

fn with_password(clone_url: &str, password: &str) -> String {
    clone_url.replacen("http://", &format!("http://agent:{password}@"), 1)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn agents_push_their_own_repo_and_admins_read_it(pool: PgPool) {
    insert_fixtures(&pool).await;
    let storage = tempfile::tempdir().unwrap();
    let work = tempfile::tempdir().unwrap();
    let base_url = start_server(pool, storage.path(), 500 * 1024 * 1024).await;
    let client = AgentGitClient::new(base_url, INTERNAL_API_KEY.to_owned()).unwrap();

    let agent_a = MacroUserIdStr::try_from("macro|agent-a@example.com".to_owned()).unwrap();
    let agent_b = MacroUserIdStr::try_from("macro|agent-b@example.com".to_owned()).unwrap();
    let repo_a = client
        .create_repo(agent_a.clone(), TEAM_ID, seed())
        .await
        .unwrap();
    let repo_b = client.create_repo(agent_b, TEAM_ID, seed()).await.unwrap();

    // Clone, commit, push with the agent's token.
    let first = git(
        work.path(),
        &[
            "clone",
            &with_password(&repo_a.clone_url, repo_a.token.expose()),
            "first",
        ],
    )
    .await;
    assert!(first.status.success(), "{first:?}");
    // A fresh HTTP clone must contain every file required before the brain
    // can start; the first turn cannot repair an incomplete seed.
    for file in WORKSPACE_TEMPLATE.render(&seed()).unwrap() {
        assert_eq!(
            std::fs::read_to_string(work.path().join("first").join(file.path)).unwrap(),
            file.contents,
            "{}",
            file.path
        );
    }
    let charter = std::fs::read_to_string(work.path().join("first/OPERATING.md")).unwrap();
    assert!(charter.contains("macro|admin@example.com"));
    assert!(!charter.contains("{{"));

    std::fs::write(work.path().join("first/memory.md"), "remembered\n").unwrap();
    let added = git(&work.path().join("first"), &["add", "memory.md"]).await;
    assert!(added.status.success(), "{added:?}");
    let committed = git(
        &work.path().join("first"),
        &["commit", "-m", "turn 1: remember"],
    )
    .await;
    assert!(committed.status.success(), "{committed:?}");
    let pushed = git(&work.path().join("first"), &["push", "origin", "main"]).await;
    assert!(pushed.status.success(), "{pushed:?}");

    // A fresh clone sees the push.
    let second = git(
        work.path(),
        &[
            "clone",
            &with_password(&repo_a.clone_url, repo_a.token.expose()),
            "second",
        ],
    )
    .await;
    assert!(second.status.success(), "{second:?}");
    assert_eq!(
        std::fs::read_to_string(work.path().join("second/memory.md")).unwrap(),
        "remembered\n"
    );

    // Recovery neither rotates the live credential nor overwrites pushed files.
    let recovered = client
        .ensure_repo(agent_a.clone(), TEAM_ID, seed(), &repo_a.token)
        .await
        .unwrap();
    assert_eq!(recovered.token.hash(), repo_a.token.hash());
    let wrong_recovery = client
        .ensure_repo(agent_a.clone(), TEAM_ID, seed(), &repo_b.token)
        .await;
    assert!(wrong_recovery.is_err());
    let preserved = git(
        work.path(),
        &[
            "clone",
            &with_password(&repo_a.clone_url, repo_a.token.expose()),
            "preserved",
        ],
    )
    .await;
    assert!(preserved.status.success(), "{preserved:?}");
    assert_eq!(
        std::fs::read_to_string(work.path().join("preserved/memory.md")).unwrap(),
        "remembered\n"
    );

    // A wrong token and another agent's token are both refused.
    let wrong_token = git(
        work.path(),
        &[
            "clone",
            &with_password(&repo_a.clone_url, "mrt_wrong"),
            "wrong",
        ],
    )
    .await;
    assert!(!wrong_token.status.success());
    assert!(
        String::from_utf8_lossy(&wrong_token.stderr).contains("Authentication failed"),
        "{wrong_token:?}"
    );

    let other_repo = git(
        work.path(),
        &[
            "clone",
            &with_password(&repo_a.clone_url, repo_b.token.expose()),
            "other",
        ],
    )
    .await;
    assert!(!other_repo.status.success());

    // The team admin reads with their API key, but cannot push.
    let admin_header = format!("http.extraHeader=x-macro-user-api-key: {ADMIN_API_KEY}");
    let admin = git(
        work.path(),
        &["-c", &admin_header, "clone", &repo_a.clone_url, "admin"],
    )
    .await;
    assert!(admin.status.success(), "{admin:?}");
    assert!(work.path().join("admin/memory.md").exists());

    std::fs::write(work.path().join("admin/edit.md"), "edit\n").unwrap();
    git(&work.path().join("admin"), &["add", "edit.md"]).await;
    git(&work.path().join("admin"), &["commit", "-m", "admin edit"]).await;
    let admin_push = git(
        &work.path().join("admin"),
        &["-c", &admin_header, "push", "origin", "main"],
    )
    .await;
    assert!(!admin_push.status.success());
    assert!(
        String::from_utf8_lossy(&admin_push.stderr).contains("403"),
        "{admin_push:?}"
    );

    // LFS is refused outright.
    let lfs = reqwest::Client::new()
        .post(repo_a.clone_url.clone() + "/info/lfs/objects/batch")
        .send()
        .await
        .unwrap();
    assert_eq!(lfs.status(), reqwest::StatusCode::NOT_IMPLEMENTED);

    // Deleting the repo removes it from disk and the API.
    client.delete_repo(&agent_a).await.unwrap();
    client.delete_repo(&agent_a).await.unwrap();
    let deleted = git(
        work.path(),
        &[
            "clone",
            &with_password(&repo_a.clone_url, repo_a.token.expose()),
            "deleted",
        ],
    )
    .await;
    assert!(!deleted.status.success());
    assert_eq!(std::fs::read_dir(storage.path()).unwrap().count(), 1);
    let recovered = client
        .ensure_repo(agent_a.clone(), TEAM_ID, seed(), &repo_a.token)
        .await
        .unwrap();
    assert_eq!(recovered.token.hash(), repo_a.token.hash());
    let recreated = git(
        work.path(),
        &[
            "clone",
            &with_password(&repo_a.clone_url, repo_a.token.expose()),
            "recreated",
        ],
    )
    .await;
    assert!(recreated.status.success(), "{recreated:?}");
    assert!(work.path().join("recreated/OPERATING.md").exists());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_repo_at_its_size_limit_refuses_pushes_with_a_message(pool: PgPool) {
    insert_fixtures(&pool).await;
    let storage = tempfile::tempdir().unwrap();
    let work = tempfile::tempdir().unwrap();
    // Every repo, even a fresh one, is over one byte.
    let base_url = start_server(pool, storage.path(), 1).await;
    let client = AgentGitClient::new(base_url, INTERNAL_API_KEY.to_owned()).unwrap();
    let agent = MacroUserIdStr::try_from("macro|agent-a@example.com".to_owned()).unwrap();
    let repo = client.create_repo(agent, TEAM_ID, seed()).await.unwrap();

    let cloned = git(
        work.path(),
        &[
            "clone",
            &with_password(&repo.clone_url, repo.token.expose()),
            "full",
        ],
    )
    .await;
    assert!(cloned.status.success(), "{cloned:?}");

    std::fs::write(work.path().join("full/more.md"), "more\n").unwrap();
    git(&work.path().join("full"), &["add", "more.md"]).await;
    git(&work.path().join("full"), &["commit", "-m", "more"]).await;
    let pushed = git(&work.path().join("full"), &["push", "origin", "main"]).await;

    assert!(!pushed.status.success());
    let stderr = String::from_utf8_lossy(&pushed.stderr);
    assert!(stderr.contains("1-byte limit"), "{stderr}");
}

fn seed() -> agent_git::domain::template::PersonaSeed {
    agent_git::domain::template::PersonaSeed {
        voice: None,
        name: "Sam".to_owned(),
        job_description: "Books venues.".to_owned(),
        personality: "Warm and direct.".to_owned(),
        creator_id: Some(
            MacroUserIdStr::parse_from_str("macro|admin@example.com")
                .expect("creator id")
                .into_owned(),
        ),
    }
}

#[tokio::test]
async fn server_voice_commit_is_idempotent_and_preserves_other_files() {
    use agent_git::domain::ports::RepoStore;
    use agent_git::domain::voice::VoiceConfig;
    let root = tempfile::tempdir().unwrap();
    let directories = RepoDirectories::new(root.path().to_path_buf());
    let store = BareRepoStore::new(directories.clone());
    let agent = MacroUserIdStr::parse_from_str("macro|agent@example.com").unwrap();
    let mut persona = seed();
    persona.voice = Some("aura-2-thalia-en".to_owned());
    store
        .create_repo(&agent, &WORKSPACE_TEMPLATE.render(&persona).unwrap())
        .await
        .unwrap();
    assert_eq!(store.voice(&agent).await.unwrap().model, "aura-2-thalia-en");
    let repo = directories.repo_path(&agent);
    let before = tokio::process::Command::new("git")
        .arg("--git-dir")
        .arg(&repo)
        .args(["rev-parse", "main:OPERATING.md"])
        .output()
        .await
        .unwrap();
    let voice = VoiceConfig {
        model: "aura-2-arcas-en".to_owned(),
    };
    store.set_voice(&agent, &voice).await.unwrap();
    assert_eq!(store.voice(&agent).await.unwrap(), voice);
    let revision = tokio::process::Command::new("git")
        .arg("--git-dir")
        .arg(&repo)
        .args(["rev-parse", "main"])
        .output()
        .await
        .unwrap();
    store.set_voice(&agent, &voice).await.unwrap();
    let repeated = tokio::process::Command::new("git")
        .arg("--git-dir")
        .arg(&repo)
        .args(["rev-parse", "main"])
        .output()
        .await
        .unwrap();
    assert_eq!(revision.stdout, repeated.stdout);
    let after = tokio::process::Command::new("git")
        .arg("--git-dir")
        .arg(&repo)
        .args(["rev-parse", "main:OPERATING.md"])
        .output()
        .await
        .unwrap();
    assert_eq!(before.stdout, after.stdout);
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
}

#[cfg(unix)]
#[tokio::test]
async fn server_voice_updates_never_follow_repository_symlinks() {
    use agent_git::domain::{ports::RepoStore, voice::VoiceConfig};
    for directory_link in [false, true] {
        let root = tempfile::tempdir().unwrap();
        let directories = RepoDirectories::new(root.path().join("repositories"));
        let store = BareRepoStore::new(directories.clone());
        let agent = MacroUserIdStr::parse_from_str("macro|agent@example.com").unwrap();
        store
            .create_repo(&agent, &WORKSPACE_TEMPLATE.render(&seed()).unwrap())
            .await
            .unwrap();
        let repo = directories.repo_path(&agent);
        assert!(
            git(root.path(), &["clone", repo.to_str().unwrap(), "checkout"])
                .await
                .status
                .success()
        );
        let checkout = root.path().join("checkout");
        let outside = root.path().join("outside");
        std::fs::create_dir(&outside).unwrap();
        let protected = outside.join("voice.json");
        std::fs::write(&protected, "protected contents").unwrap();
        if directory_link {
            std::fs::remove_dir_all(checkout.join("config")).unwrap();
            std::os::unix::fs::symlink(&outside, checkout.join("config")).unwrap();
        } else {
            std::fs::remove_file(checkout.join("config/voice.json")).unwrap();
            std::os::unix::fs::symlink(&protected, checkout.join("config/voice.json")).unwrap();
        }
        assert!(git(&checkout, &["add", "--all"]).await.status.success());
        assert!(
            git(&checkout, &["commit", "-m", "Change repository paths"])
                .await
                .status
                .success()
        );
        assert!(
            git(&checkout, &["push", "origin", "main"])
                .await
                .status
                .success()
        );
        let result = store
            .set_voice(
                &agent,
                &VoiceConfig {
                    model: "aura-2-arcas-en".to_owned(),
                },
            )
            .await;
        assert_eq!(result.is_err(), directory_link);
        assert_eq!(
            std::fs::read_to_string(&protected).unwrap(),
            "protected contents"
        );
        if !directory_link {
            assert_eq!(store.voice(&agent).await.unwrap().model, "aura-2-arcas-en");
        }
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn compressed_push_is_rejected_without_writing_the_repository(pool: PgPool) {
    use agent_git::domain::ports::RepoStore;
    use std::io::{Read, Write};

    insert_fixtures(&pool).await;
    let storage = tempfile::tempdir().unwrap();
    let base = start_server(pool, storage.path(), 1024 * 1024).await;
    let client = AgentGitClient::new(base.clone(), INTERNAL_API_KEY.to_owned()).unwrap();
    let agent = MacroUserIdStr::try_from("macro|agent-a@example.com".to_owned()).unwrap();
    let repo = client
        .create_repo(agent.clone(), TEAM_ID, seed())
        .await
        .unwrap();
    let store = BareRepoStore::new(RepoDirectories::new(storage.path().to_path_buf()));
    let before = store.repo_size_bytes(&agent).await.unwrap();

    // A small, valid gzip request with a 5 MiB inflated body and optional header.
    let mut gzip = flate2::GzBuilder::new()
        .extra(vec![0; 6000])
        .write(Vec::new(), flate2::Compression::default());
    gzip.write_all(&vec![0; 5 * 1024 * 1024]).unwrap();
    let compressed = gzip.finish().unwrap();
    assert!((10_000..12_000).contains(&compressed.len()));
    let mut expanded = Vec::new();
    flate2::read::GzDecoder::new(compressed.as_slice())
        .read_to_end(&mut expanded)
        .unwrap();
    assert_eq!(expanded.len(), 5 * 1024 * 1024);

    for encoding in ["gzip", "identity", ""] {
        let response = reqwest::Client::new()
            .post(format!("{}/git-receive-pack", repo.clone_url))
            .basic_auth("agent", Some(repo.token.expose()))
            .header("Content-Encoding", encoding)
            .header("Content-Type", "application/x-git-receive-pack-request")
            .body(compressed.clone())
            .send()
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            reqwest::StatusCode::UNSUPPORTED_MEDIA_TYPE
        );
        assert_eq!(store.repo_size_bytes(&agent).await.unwrap(), before);
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn missing_repo_and_bad_token_have_the_same_authentication_response(pool: PgPool) {
    insert_fixtures(&pool).await;
    let storage = tempfile::tempdir().unwrap();
    let base = start_server(pool, storage.path(), 1024 * 1024).await;
    let client = AgentGitClient::new(base.clone(), INTERNAL_API_KEY.to_owned()).unwrap();
    let agent = MacroUserIdStr::try_from("macro|agent-a@example.com".to_owned()).unwrap();
    let repo = client.create_repo(agent, TEAM_ID, seed()).await.unwrap();
    let http = reqwest::Client::new();
    let existing = http
        .get(format!(
            "{}/info/refs?service=git-upload-pack",
            repo.clone_url
        ))
        .basic_auth("agent", Some("bad-token"))
        .send()
        .await
        .unwrap();
    let missing = http
        .get(format!(
            "{base}/macro%7Cmissing%40example.com.git/info/refs?service=git-upload-pack"
        ))
        .basic_auth("agent", Some("bad-token"))
        .send()
        .await
        .unwrap();
    assert_eq!(existing.status(), reqwest::StatusCode::UNAUTHORIZED);
    assert_eq!(missing.status(), existing.status());
    assert_eq!(
        missing.headers().get("www-authenticate"),
        existing.headers().get("www-authenticate")
    );
    assert_eq!(
        missing.bytes().await.unwrap(),
        existing.bytes().await.unwrap()
    );
}
