use super::*;
use crate::{
    domain::{ports::Repository, service::PasswordService},
    outbound::postgres::PgRepository,
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    task::{JoinHandle, JoinSet},
};
use zeroize::Zeroizing;

#[derive(Default)]
struct InterruptedLookup {
    accepted_writes: AtomicUsize,
    fail_next_request: AtomicBool,
    interrupted_requests: AtomicUsize,
}

struct RecoveryProxy {
    address: String,
    observed: Arc<InterruptedLookup>,
    server: JoinHandle<()>,
}

impl Drop for RecoveryProxy {
    fn drop(&mut self) {
        self.server.abort();
    }
}

impl RecoveryProxy {
    async fn start(upstream: &str) -> Self {
        let url = url::Url::parse(upstream).expect("disposable provider URL");
        assert_eq!(url.scheme(), "http", "fixture proxy uses local HTTP only");
        let target = tokio::net::lookup_host((
            url.host_str().expect("provider host"),
            url.port_or_known_default().expect("provider port"),
        ))
        .await
        .expect("resolve disposable provider")
        .next()
        .expect("provider address");
        assert!(target.ip().is_loopback(), "disposable local provider only");
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("fixture proxy listener");
        let address = format!("http://{}", listener.local_addr().expect("fixture address"));
        let observed = Arc::new(InterruptedLookup::default());
        let state = observed.clone();
        let server = tokio::spawn(async move {
            let mut connections = JoinSet::new();
            loop {
                tokio::select! {
                    connection = listener.accept() => {
                        let (client, _) = connection.expect("fixture connection");
                        let state = state.clone();
                        connections.spawn(async move {
                            tokio::time::timeout(Duration::from_secs(30), forward(client, target, state))
                                .await.expect("bounded fixture forwarding").expect("fixture forwarding");
                        });
                    }
                    completed = connections.join_next(), if !connections.is_empty() => {
                        completed.expect("fixture task").expect("fixture forwarding task");
                    }
                }
            }
        });
        Self {
            address,
            observed,
            server,
        }
    }
}

// One request per connection, using the client's fixed-length JSON framing.
// Forward raw response bytes so the fixture needs no alternate Bao JSON client.
async fn forward(
    mut client: TcpStream,
    target: std::net::SocketAddr,
    state: Arc<InterruptedLookup>,
) -> std::io::Result<()> {
    let mut request = Zeroizing::new(Vec::new());
    let mut buffer = Zeroizing::new([0_u8; 4096]);
    let header_end = loop {
        let count = client.read(&mut buffer[..]).await?;
        assert!(count > 0, "complete fixture request headers");
        request.extend_from_slice(&buffer[..count]);
        assert!(request.len() <= 256 * 1024, "bounded fixture request");
        if let Some(end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
            break end + 4;
        }
    };
    let (length, write, mut forwarded) = {
        let headers = std::str::from_utf8(&request[..header_end]).expect("HTTP headers");
        let mut lines = headers.split("\r\n");
        let first = lines.next().expect("request line");
        let write = first.starts_with("POST /v1/passwords/data/");
        let mut length = 0;
        let mut forwarded = Zeroizing::new(Vec::new());
        forwarded.extend_from_slice(first.as_bytes());
        forwarded.extend_from_slice(b"\r\n");
        for line in lines.filter(|line| !line.is_empty()) {
            let (name, value) = line.split_once(':').expect("header separator");
            assert!(!name.eq_ignore_ascii_case("transfer-encoding"));
            if name.eq_ignore_ascii_case("content-length") {
                length = value.trim().parse::<usize>().expect("content length");
            }
            if !name.eq_ignore_ascii_case("connection") {
                forwarded.extend_from_slice(line.as_bytes());
                forwarded.extend_from_slice(b"\r\n");
            }
        }
        forwarded.extend_from_slice(b"Connection: close\r\n\r\n");
        (length, write, forwarded)
    };
    assert!(length <= 256 * 1024, "bounded fixture body");
    while request.len() < header_end + length {
        let count = client.read(&mut buffer[..]).await?;
        assert!(count > 0, "complete fixture request body");
        request.extend_from_slice(&buffer[..count]);
    }
    // The team token is cached, so the post-write lookup is the next request,
    // not a new login.
    if state.fail_next_request.swap(false, Ordering::SeqCst) {
        state.interrupted_requests.fetch_add(1, Ordering::SeqCst);
        client
            .write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .await?;
        return Ok(());
    }
    forwarded.extend_from_slice(&request[header_end..header_end + length]);
    let mut upstream = TcpStream::connect(target).await?;
    upstream.write_all(&forwarded).await?;
    let mut response = Zeroizing::new(Vec::new());
    upstream
        .take(4 * 1024 * 1024)
        .read_to_end(&mut response)
        .await?;
    let accepted = response.starts_with(b"HTTP/1.1 200 ") || response.starts_with(b"HTTP/1.1 204 ");
    if write && accepted {
        state.accepted_writes.fetch_add(1, Ordering::SeqCst);
        state.fail_next_request.store(true, Ordering::SeqCst);
    }
    client.write_all(&response).await
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
#[ignore = "requires explicit disposable local OpenBao and bootstrap signing key"]
#[expect(
    clippy::disallowed_methods,
    reason = "disposable fixture requires explicit process environment and must never inherit APP_SECRETS_JSON"
)]
async fn accepted_create_survives_postwrite_lookup_interruption_and_same_operation_retry(
    pool: sqlx::PgPool,
) {
    let address = std::env::var("PASSWORDS_TEST_OPENBAO_ADDRESS")
        .expect("explicit disposable local OpenBao address");
    let key_path = std::env::var("PASSWORDS_TEST_OPENBAO_SIGNING_KEY")
        .expect("explicit synthetic signing key file");
    let public_key_path = std::env::var("PASSWORDS_TEST_OPENBAO_PUBLIC_KEY")
        .expect("explicit synthetic public key file");
    let team = TeamId(uuid::Uuid::now_v7());
    assert!(
        Command::new("python3")
            .args([
                "../../infra/local/openbao/bootstrap.py",
                "--address",
                &address,
                "--team-id",
                &team.0.to_string(),
                "--jwt-public-key",
                &public_key_path,
                "--jwt-issuer",
                "macro-local-passwords",
            ])
            .output()
            .expect("bootstrap isolated namespace")
            .status
            .success()
    );
    let owner = Actor {
        user_id: MacroUserIdStr::parse_from_str("macro|enrollment@example.test")
            .expect("synthetic identity")
            .into_owned(),
    };
    let macro_user_id = uuid::Uuid::now_v7();
    sqlx::query!("INSERT INTO macro_user(id,username,email,stripe_customer_id) VALUES ($1,'enrollment@example.test','enrollment@example.test',$2)",macro_user_id,format!("fixture-{macro_user_id}"))
        .execute(&pool).await.expect("fixture account");
    sqlx::query!(
        r#"INSERT INTO "User"(id,email,macro_user_id) VALUES ($1,'enrollment@example.test',$2)"#,
        owner.user_id.as_ref(),
        macro_user_id
    )
    .execute(&pool)
    .await
    .expect("fixture human");
    sqlx::query!(
        "INSERT INTO team(id,name,owner_id) VALUES ($1,'Fixture',$2)",
        team.0,
        owner.user_id.as_ref()
    )
    .execute(&pool)
    .await
    .expect("fixture team");
    sqlx::query!(
        "INSERT INTO team_user(user_id,team_id,team_role) VALUES ($1,$2,'owner')",
        owner.user_id.as_ref(),
        team.0
    )
    .execute(&pool)
    .await
    .expect("fixture membership");
    let repository = Arc::new(PgRepository::new(pool.clone()).expect("repository capacity"));
    let proxy = RecoveryProxy::start(&address).await;
    let provider = Arc::new(
        OpenBaoProvider::new(
            proxy.address.clone(),
            "macro-local-passwords".into(),
            &std::fs::read_to_string(key_path).expect("fixture signing key"),
        )
        .expect("provider"),
    );
    let service = PasswordService {
        repository: repository.clone(),
        provider: provider.clone(),
        availability: Arc::new(Available),
    };
    let operation = uuid::Uuid::now_v7();
    let item = ItemId(operation);
    let command = || WriteItem {
        operation_id: operation,
        name: "Interrupted credential".into(),
        kind: ItemKind::Login,
        url: None,
        folder_id: None,
        favorite: false,
        private: true,
        expected_version: None,
        values: SecretValues {
            username: SecretString("synthetic-account".into()),
            password: SecretString("synthetic-private-value".into()),
            notes: SecretString("synthetic-private-notes".into()),
            fields: vec![],
        },
    };
    assert!(matches!(
        service.create(&owner, team, command()).await,
        Err(Error::Unavailable)
    ));
    assert_eq!(proxy.observed.accepted_writes.load(Ordering::SeqCst), 1);
    assert_eq!(
        proxy.observed.interrupted_requests.load(Ordering::SeqCst),
        1
    );
    assert!(matches!(
        repository.get(team, item).await,
        Err(Error::NotFound)
    ));
    let staged = repository
        .staged(team, item, operation)
        .await
        .expect("retained intent");
    assert_eq!(staged.metadata.version, 1);
    assert!(staged.user_id == owner.user_id);
    assert!(staged.grants.is_empty());
    assert!(
        repository
            .activity(team, item)
            .await
            .expect("no activity")
            .is_empty()
    );
    assert!(!intent_completed(&pool, team, item, operation).await);
    assert_eq!(
        provider
            .current_version(team, item)
            .await
            .expect("accepted provider version"),
        Some(1)
    );
    assert_eq!(
        provider
            .status(team, item)
            .await
            .expect("accepted operation marker"),
        Some((1, operation))
    );
    drain_fixture_rollbacks(&pool).await;
    let recovered = service
        .create(&owner, team, command())
        .await
        .expect("same operation retry");
    assert_eq!(recovered.id, item);
    assert_eq!(recovered.version, 1);
    assert!(intent_completed(&pool, team, item, operation).await);
    drain_fixture_rollbacks(&pool).await;
    let replay = service
        .create(&owner, team, command())
        .await
        .expect("same operation replay");
    assert_eq!(replay.id, item);
    assert_eq!(replay.version, 1);
    assert!(intent_completed(&pool, team, item, operation).await);
    assert_eq!(
        repository
            .list(&owner, team, "")
            .await
            .expect("one item")
            .len(),
        1
    );
    let stored = repository
        .get(team, item)
        .await
        .expect("reconciled metadata");
    assert!(stored.user_id == owner.user_id);
    assert!(stored.grants.is_empty());
    let activity = repository
        .activity(team, item)
        .await
        .expect("committed audit");
    assert_eq!(activity.len(), 1);
    assert_eq!(activity[0].id, operation);
    assert!(matches!(activity[0].action, Action::Create));
    assert_eq!(
        provider
            .current_version(team, item)
            .await
            .expect("provider version"),
        Some(1)
    );
    assert_eq!(
        provider.status(team, item).await.expect("operation marker"),
        Some((1, operation))
    );
    let versions = provider.history(team, item).await.expect("one KV version");
    assert_eq!(versions.len(), 1);
    assert_eq!(versions[0].version, 1);
    let values = provider
        .read(team, item, 1)
        .await
        .expect("preserved values");
    // Compare privately: assertion diagnostics must never format secret content.
    assert!(values.username.0 == command().values.username.0);
    assert!(values.password.0 == command().values.password.0);
    assert!(values.notes.0 == command().values.notes.0);
    assert!(values.fields.is_empty());
    assert_eq!(proxy.observed.accepted_writes.load(Ordering::SeqCst), 1);
    assert_eq!(
        proxy.observed.interrupted_requests.load(Ordering::SeqCst),
        1
    );
}

// Fence the operation primary-key lookup before checking the retained scope.
async fn intent_completed(
    pool: &sqlx::PgPool,
    team: TeamId,
    item: ItemId,
    operation: uuid::Uuid,
) -> bool {
    sqlx::query!(
        r#"SELECT completed_at IS NOT NULL AS "completed!"
FROM (
    SELECT completed_at,team_id,item_id
    FROM password_write_intents
    WHERE operation_id=$1
    OFFSET 0
) intent
WHERE team_id=$2 AND item_id=$3;"#,
        operation,
        team.0,
        item.0
    )
    .fetch_one(pool)
    .await
    .expect("retained intent completion")
    .completed
}
