//! Real `git` against the router on a random port, with Postgres and a temp
//! storage root.

use std::path::Path;
use std::process::Output;
use std::sync::Arc;

use agent_git::client::AgentGitClient;
use agent_git::domain::models::RepoLimits;
use agent_git::domain::ports::{PushRateLimiter, RepoRepository};
use agent_git::domain::service::{AgentGitAdapters, AgentGitServiceImpl};
use agent_git::domain::template::WORKSPACE_TEMPLATE;
use agent_git::inbound::http::{AgentGitRouterState, agent_git_router};
use agent_git::outbound::bare_repo_store::BareRepoStore;
use agent_git::outbound::git_http_backend::GitHttpBackend;
use agent_git::outbound::pg_repo_repository::PgRepoRepository;
use agent_git::outbound::push_rate_limiter::PgPushRateLimiter;
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
/// The agent teammates rollout, on for everyone.
struct Rollout;

impl feature_flags::FeatureFlags for Rollout {
    async fn load(
        &self,
        _: &MacroUserIdStr<'_>,
    ) -> Result<feature_flags::FlagSnapshot, rootcause::Report> {
        Ok(feature_flags::FlagSnapshot::new([(
            agent_credentials::AGENT_TEAMMATES_FLAG.to_owned(),
            feature_flags::FlagValue::Boolean(true),
        )]))
    }
}

async fn start_server(pool: PgPool, storage_root: &Path, max_repo_size_bytes: u64) -> String {
    let directories = RepoDirectories::new(storage_root.to_path_buf());
    let service = AgentGitServiceImpl::new(
        AgentGitAdapters {
            repos: PgRepoRepository::new(pool.clone()),
            store: BareRepoStore::new(directories.clone()),
            admins: TeamRepositoryAdmins::new(teams::outbound::team_repo::TeamRepositoryImpl::new(
                pool.clone(),
            )),
            limiter: PgPushRateLimiter::new(pool.clone(), 30),
            backend: GitHttpBackend::new(directories, tokio_util::task::TaskTracker::new()),
            flags: Some(Rollout),
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
    // A fresh HTTP clone must contain every file required before the agent
    // can start; its first wake cannot repair an incomplete seed.
    for file in WORKSPACE_TEMPLATE.render(&agent_a, &seed()).unwrap() {
        assert_eq!(
            std::fs::read_to_string(work.path().join("first").join(file.path)).unwrap(),
            file.contents,
            "{}",
            file.path
        );
    }
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(work.path().join("first/bin/agent"))
            .unwrap()
            .permissions()
            .mode();
        assert_ne!(mode & 0o111, 0, "bin/agent is executable");
    }
    let settings = std::fs::read_to_string(work.path().join("first/agent.json")).unwrap();
    assert!(settings.contains("\"owner\": \"macro|admin@example.com\""));

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
    assert!(work.path().join("recreated/agent.json").exists());
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
        name: "Sam".to_owned(),
        job_description: "Books venues.".to_owned(),
        personality: "Warm and direct.".to_owned(),
        voice: None,
        creator_id: Some(
            MacroUserIdStr::parse_from_str("macro|admin@example.com")
                .expect("creator id")
                .into_owned(),
        ),
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_voice_change_is_one_server_commit_that_keeps_the_agents_work(pool: PgPool) {
    use agent_git::domain::voice::{VoiceConfig, VoiceModel};

    insert_fixtures(&pool).await;
    let storage = tempfile::tempdir().unwrap();
    let work = tempfile::tempdir().unwrap();
    let base = start_server(pool, storage.path(), 1024 * 1024).await;
    let client = AgentGitClient::new(base, INTERNAL_API_KEY.to_owned()).unwrap();
    let agent = MacroUserIdStr::try_from("macro|agent-a@example.com".to_owned()).unwrap();
    let mut chosen = seed();
    chosen.voice = Some(VoiceModel::parse("aura-2-thalia-en").unwrap());
    let repo = client
        .create_repo(agent.clone(), TEAM_ID, chosen)
        .await
        .unwrap();
    let clone_url = with_password(&repo.clone_url, repo.token.expose());
    assert_eq!(
        client
            .voice(&agent, TEAM_ID)
            .await
            .unwrap()
            .unwrap()
            .model
            .as_str(),
        "aura-2-thalia-en"
    );

    // The agent pushes work the server commit must keep.
    let cloned = git(work.path(), &["clone", &clone_url, "agent"]).await;
    assert!(cloned.status.success(), "{cloned:?}");
    let checkout = work.path().join("agent");
    std::fs::write(checkout.join("memory.md"), "remembered\n").unwrap();
    assert!(git(&checkout, &["add", "memory.md"]).await.status.success());
    assert!(
        git(&checkout, &["commit", "-m", "remember"])
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

    let arcas = VoiceConfig {
        model: VoiceModel::parse("aura-2-arcas-en").unwrap(),
    };
    client
        .set_voice(&agent, TEAM_ID, arcas.clone())
        .await
        .unwrap();
    client
        .set_voice(&agent, TEAM_ID, arcas.clone())
        .await
        .unwrap();
    assert_eq!(client.voice(&agent, TEAM_ID).await.unwrap(), Some(arcas));

    let pulled = git(&checkout, &["pull", "--ff-only", "origin", "main"]).await;
    assert!(pulled.status.success(), "{pulled:?}");
    let log = git(&checkout, &["log", "--format=%an %s", "-3"]).await;
    assert_eq!(
        String::from_utf8_lossy(&log.stdout),
        "Macro Set call voice\nAgent remember\nMacro Initial workspace\n"
    );
    assert_eq!(
        std::fs::read_to_string(checkout.join("memory.md")).unwrap(),
        "remembered\n"
    );
    assert_eq!(
        std::fs::read_to_string(checkout.join("config/voice.json")).unwrap(),
        "{\n  \"model\": \"aura-2-arcas-en\"\n}\n"
    );

    assert!(matches!(
        client
            .set_voice(
                &agent,
                Uuid::from_u128(2),
                VoiceConfig {
                    model: VoiceModel::parse("aura-2-thalia-en").unwrap(),
                },
            )
            .await,
        Err(agent_git::client::AgentGitClientError::TeamMismatch)
    ));
}

#[tokio::test]
async fn voice_commits_never_follow_symlinks_the_agent_committed() {
    use agent_git::domain::ports::RepoStore;

    for config_is_a_link in [false, true] {
        let root = tempfile::tempdir().unwrap();
        let storage = root.path().join("repos");
        std::fs::create_dir(&storage).unwrap();
        let directories = RepoDirectories::new(storage);
        let store = BareRepoStore::new(directories.clone());
        let agent = MacroUserIdStr::try_from("macro|agent-a@example.com".to_owned()).unwrap();
        store
            .create_repo(&agent, &WORKSPACE_TEMPLATE.render(&agent, &seed()).unwrap())
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
        std::fs::write(&protected, "protected\n").unwrap();
        let config = checkout.join("config");
        std::fs::create_dir_all(&config).unwrap();
        if config_is_a_link {
            std::fs::remove_dir_all(&config).unwrap();
            std::os::unix::fs::symlink(&outside, &config).unwrap();
        } else {
            if config.join("voice.json").exists() {
                std::fs::remove_file(config.join("voice.json")).unwrap();
            }
            std::os::unix::fs::symlink(&protected, config.join("voice.json")).unwrap();
        }
        assert!(git(&checkout, &["add", "--all"]).await.status.success());
        assert!(
            git(&checkout, &["commit", "-m", "links"])
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

        // A symlink is never read as the voice.
        assert_eq!(
            store.read_file(&agent, "config/voice.json").await.unwrap(),
            None
        );
        let committed = store
            .commit_file(
                &agent,
                "config/voice.json",
                b"{\"model\":\"aura-2-arcas-en\"}\n",
                "Set call voice",
            )
            .await;

        assert_eq!(committed.is_err(), config_is_a_link);
        assert_eq!(std::fs::read_to_string(&protected).unwrap(), "protected\n");
        if !config_is_a_link {
            assert_eq!(
                store.read_file(&agent, "config/voice.json").await.unwrap(),
                Some(b"{\"model\":\"aura-2-arcas-en\"}\n".to_vec())
            );
        }
        // Only the repo is left in the storage root: no scratch index.
        assert_eq!(std::fs::read_dir(directories.root()).unwrap().count(), 1);
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn every_replica_draws_from_one_push_budget_that_refills(pool: PgPool) {
    insert_fixtures(&pool).await;
    sqlx::query!(
        "INSERT INTO agent_repos (agent_user_id, team_id, token_hash) VALUES ($1, $2, 'x'), ($3, $2, 'y')",
        "macro|agent-a@example.com",
        Uuid::parse_str("01900000-0000-7000-8000-000000000001").unwrap(),
        "macro|agent-b@example.com",
    )
    .execute(&pool)
    .await
    .unwrap();
    let agent = MacroUserIdStr::try_from("macro|agent-a@example.com".to_owned()).unwrap();
    let other = MacroUserIdStr::try_from("macro|agent-b@example.com".to_owned()).unwrap();
    // Two replicas, one database.
    let first = PgPushRateLimiter::new(pool.clone(), 2);
    let second = PgPushRateLimiter::new(pool.clone(), 2);

    assert!(first.try_acquire_push(&agent).await.unwrap());
    assert!(second.try_acquire_push(&agent).await.unwrap());
    assert!(!first.try_acquire_push(&agent).await.unwrap());
    assert!(second.try_acquire_push(&other).await.unwrap());

    // Half a minute later the bucket holds one more push.
    sqlx::query!(
        "UPDATE agent_repos SET push_tokens_refilled_at = push_tokens_refilled_at - interval '30 seconds' WHERE agent_user_id = $1",
        "macro|agent-a@example.com",
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(second.try_acquire_push(&agent).await.unwrap());
    assert!(!first.try_acquire_push(&agent).await.unwrap());

    let missing = MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap();
    assert!(!first.try_acquire_push(&missing).await.unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_repo_lock_excludes_other_replicas_until_it_drops(pool: PgPool) {
    let first = PgRepoRepository::new(pool.clone());
    let second = PgRepoRepository::new(pool.clone());
    let agent = MacroUserIdStr::try_from("macro|agent-a@example.com".to_owned()).unwrap();
    let other = MacroUserIdStr::try_from("macro|agent-b@example.com".to_owned()).unwrap();

    let held = first.lock_repo(&agent).await.unwrap();
    // Another repo's lock is independent.
    drop(second.lock_repo(&other).await.unwrap());

    // Held: no other session can take it.
    let free = sqlx::query_scalar!(
        r#"SELECT pg_try_advisory_lock(hashtextextended('agent_git:' || $1, 0)) AS "free!""#,
        agent.as_ref(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!free);

    // Dropping it ends its session; the other replica's wait then returns.
    drop(held);
    drop(second.lock_repo(&agent).await.unwrap());
}
