//! One scenario's world: both provider emulators, the scenario's own
//! database, Redis database and queues, and the real `email_service` and
//! `pubsub_workers` binaries running against them, with
//! `document_storage_service` beside them when the scenario asks.

mod calendar_environment;
mod calendar_reads;
mod document_storage_environment;
mod environment;

use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

use gmail_emulator::{GmailEmulator, PushConfig};
use outlook_emulator::OutlookEmulator;
use rootcause::prelude::*;
use sqlx::PgPool;
use tokio::net::TcpListener;
use uuid::Uuid;

use self::calendar_reads::CalendarReads;
pub use self::calendar_reads::CalendarSignal;
use crate::aws::{Aws, StoredObject};
use crate::evidence::{Collected, Recorder, counted, path_shape, shape};
use crate::inbox::{Mail, Provider};
use crate::infra::postgres::Database;
use crate::infra::redis::RedisDatabase;
use crate::infra::sqs::Queues;
use crate::macro_services::{HeldRequest, MacroServices, ServiceRequest};
use crate::process::ServiceProcess;
use crate::recording_proxy::RecordingProxy;
use crate::tls::TlsFront;
use crate::user::User;
use crate::wait::eventually;

/// The API binary.
const API: &str = "email_service";
/// The binary that runs the queue workers and the Outlook mailbox loops.
const WORKERS: &str = "pubsub_workers";
/// The service behind the GraphQL API.
const DOCUMENT_STORAGE: &str = "document_storage_service";
/// The service that keeps the search index up to date.
const SEARCH_INDEXER: &str = "search_processing_service";
/// The consumer group the search indexer reads the event topics in.
const SEARCH_INDEXER_GROUP: &str = "search-processing-service";
/// The setting that names the Kafka brokers.
const KAFKA_BROKERS: &str = "KAFKA_BROKERS";
/// Where that service answers GraphQL.
pub(crate) const GRAPHQL_PATH: &str = "/items/soup/graphql";
/// The calendar service's binary.
const CALENDAR: &str = "calendar_service";
/// The stand-in for the app service, which calendar scheduling names in
/// meeting links.
const APP: &str = "app";
/// The Lambda binary of the scheduled-send sweep.
const SCHEDULED_HANDLER: &str = "email_scheduled_handler";
/// The topic the email services publish their events to.
const EMAIL_EVENTS: &str = "macro.email";
/// What the name of a queue's dead-letter queue ends with, in the evidence.
const DEAD_LETTER_SUFFIX: &str = "-dlq";
/// Every inbox the scenario linked, with its provider: the ones still
/// linked and the ones unlinked since.
const LINKS_QUERY: &str = "SELECT lower(provider::text), id::text FROM email_links \
     UNION SELECT lower(provider::text), link_id::text FROM email_links_history";
/// How long a service gets to answer its health check.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(120);
/// How often a service is started again on another port when the one picked
/// for it was taken in between.
const PORT_ATTEMPTS: u8 = 3;
/// What a Rust process writes when a thread panics.
const PANIC_MARKER: &str = "panicked at";
/// What a service logs once it has bound its port.
const SERVING_MARKER: &str = "is up and running";

/// How a stack differs from the default one.
#[derive(Clone, Debug, Default)]
pub struct StackOptions {
    /// Environment variables for every service the stack starts, set after the stack's own,
    /// so they can replace them.
    pub env: Vec<(String, String)>,
    /// Also start `document_storage_service`, which serves the GraphQL API
    /// the web app sends mail through ([`User::graphql`]). Off by default:
    /// it is a third large process per scenario.
    pub document_storage: bool,
    /// Also start search: `search_processing_service` indexing the
    /// scenario's mail into the OpenSearch cluster at
    /// `EMAIL_E2E_OPENSEARCH_URL`, and `document_storage_service` (as with
    /// `document_storage`) answering [`User::search`] from it. The cluster
    /// and the indexer's consumer group are shared by every scenario, so
    /// these scenarios run one at a time (the `email-e2e-search` test
    /// group) and each uses addresses no other scenario does.
    pub search: bool,
    /// Also runs `calendar_service` and the calendar read routes, so inboxes
    /// can be linked with their calendars ([`User::link_gmail_with_calendar`],
    /// [`User::link_outlook_with_calendar`]). `env` reaches that service too.
    pub calendar: bool,
}

/// What a stack with calendar runs on top of the email services.
struct CalendarPart {
    service: ServiceProcess,
    /// The service as the gateway exposes it, under `/calendar`.
    url: String,
    reads: CalendarReads,
}

/// A running stack. Start one per scenario and end the scenario with
/// [`Stack::finish`].
pub struct Stack {
    gmail: GmailEmulator,
    outlook: OutlookEmulator,
    database: Option<Database>,
    redis: Option<RedisDatabase>,
    queues: Option<Queues>,
    aws: Option<Aws>,
    macro_services: Option<MacroServices>,
    tls: Option<TlsFront>,
    /// What the scenario made the services do.
    recorder: Recorder,
    /// The listeners scenarios and providers reach the API and the GraphQL
    /// API through, which record what was served.
    api_proxy: Option<RecordingProxy>,
    graphql_proxy: Option<RecordingProxy>,
    /// Where the email event topic ended when the stack started.
    event_starts: Vec<(i32, i64)>,
    api: ServiceProcess,
    workers: Option<ServiceProcess>,
    document_storage: Option<ServiceProcess>,
    search_indexer: Option<ServiceProcess>,
    /// The search cluster, on a stack that searches.
    opensearch_url: Option<String>,
    graphql_url: Option<String>,
    calendar: Option<CalendarPart>,
    worker_env: BTreeMap<String, String>,
    api_url: String,
    internal_api_key: String,
    http: reqwest::Client,
    log_dir: PathBuf,
    finished: bool,
}

impl Stack {
    /// Starts a stack with the default options.
    pub async fn start() -> Result<Self, Report> {
        Self::start_with(StackOptions::default()).await
    }

    /// Starts a stack.
    pub async fn start_with(options: StackOptions) -> Result<Self, Report> {
        let servers = environment::Servers::from_env()?;
        let id = Uuid::now_v7().simple().to_string();
        let log_dir = log_dir(&id)?;
        crate::process::ensure_built(&[API, WORKERS])?;
        if options.calendar {
            crate::process::ensure_built(&[CALENDAR])?;
        }

        let gmail = GmailEmulator::start(gmail_emulator::Seed::default())
            .await
            .context("could not start the Gmail emulator")?;
        let outlook = OutlookEmulator::start_on(
            SocketAddr::from(([127, 0, 0, 1], 0)),
            outlook_emulator::Seed::default(),
            outlook_emulator::Options {
                trusted_certificates: vec![crate::tls::AUTHORITY.as_bytes().to_vec()],
                ..outlook_emulator::Options::default()
            },
        )
        .await
        .context("could not start the Outlook emulator")?;

        // From here on a failure must give back what was created: the stack
        // that would do it on drop does not exist yet.
        let database = Database::create(&servers.postgres).await?;
        let redis = match RedisDatabase::lease(&servers.redis).await {
            Ok(redis) => redis,
            Err(error) => {
                discard(database, None, None).await;
                return Err(error);
            }
        };
        let queue_prefix = format!("e2e-{id}");
        let mut queues = match Queues::create(&servers.sqs, &queue_prefix).await {
            Ok(queues) => queues,
            Err(error) => {
                discard(database, Some(redis), None).await;
                return Err(error);
            }
        };
        if options.calendar
            && let Err(error) = queues.add_calendar_backfill(&queue_prefix).await
        {
            discard(database, Some(redis), Some(queues)).await;
            return Err(error);
        }
        let recorder = Recorder::default();
        // A broker that cannot be asked yet is asked again at the end, from
        // the topic's start.
        let event_starts = crate::infra::kafka::topic_ends(&servers.kafka, EMAIL_EVENTS)
            .await
            .unwrap_or_default();
        let booted = Self::boot(
            &options, &servers, &gmail, &outlook, &database, &redis, &queues, &log_dir, &recorder,
        )
        .await;
        let booted = match booted {
            Ok(booted) => booted,
            Err(error) => {
                discard(database, Some(redis), Some(queues)).await;
                return Err(error);
            }
        };
        let Booted {
            aws,
            macro_services,
            http,
            api,
            tls,
            api_proxy,
            env,
            api_url,
            workers,
        } = booted;
        gmail.set_push(Some(PushConfig::new(format!("{api_url}/gmail/webhook"))));

        // The services take the key from their environment, which a
        // scenario may have replaced.
        let internal_api_key = env
            .get("INTERNAL_API_KEY")
            .cloned()
            .unwrap_or_else(|| environment::INTERNAL_API_KEY.to_owned());

        let app_url = macro_services.url(APP);
        let mut stack = Self {
            gmail,
            outlook,
            database: Some(database),
            redis: Some(redis),
            queues: Some(queues),
            aws: Some(aws),
            macro_services: Some(macro_services),
            tls: Some(tls),
            recorder,
            api_proxy: Some(api_proxy),
            graphql_proxy: None,
            event_starts,
            api,
            workers: Some(workers),
            document_storage: None,
            search_indexer: None,
            opensearch_url: None,
            graphql_url: None,
            calendar: None,
            worker_env: env,
            api_url,
            internal_api_key,
            http,
            log_dir,
            finished: false,
        };
        // The stack exists now, so a failure from here on is cleaned up by
        // its drop.
        if options.search {
            stack.opensearch_url = Some(environment::opensearch_url()?);
        }
        if options.document_storage || options.search {
            stack.start_document_storage(&options).await?;
        }
        if options.search {
            stack.start_search_indexer(&options).await?;
        }
        if options.calendar {
            let calendar = start_calendar(
                &stack.http,
                &stack.worker_env,
                &app_url,
                &options.env,
                stack.db(),
                &stack.log_dir,
            )
            .await?;
            stack.calendar = Some(calendar);
        }
        Ok(stack)
    }

    /// Starts `document_storage_service` on the scenario's database, Redis
    /// database, queues and providers.
    async fn start_document_storage(&mut self, options: &StackOptions) -> Result<(), Report> {
        crate::process::ensure_built(&[DOCUMENT_STORAGE])?;
        let Some(queues) = &mut self.queues else {
            bail!("the stack was torn down");
        };
        queues.add_document_storage_queues().await?;
        if let Some(brokers) = self.worker_env.get(KAFKA_BROKERS) {
            crate::infra::kafka::ensure_topics(brokers).await?;
        }
        for queue in queues.all() {
            self.worker_env
                .insert(queue.override_env.to_owned(), queue.url.clone());
        }
        // What the scenario set stays on top, as it was at the first start.
        self.worker_env.extend(options.env.iter().cloned());

        let mut attempt = 0;
        loop {
            attempt += 1;
            let port = free_port().await?;
            let mut env = document_storage_environment::document_storage_env(
                &document_storage_environment::DocumentStorage {
                    port,
                    database_url: self.database().url(),
                    search_url: self.search_cluster_url(),
                    email_env: &self.worker_env,
                },
            );
            env.extend(options.env.iter().cloned());

            let mut service = ServiceProcess::spawn(DOCUMENT_STORAGE, &env, &self.log_dir)?;
            let url = format!("http://127.0.0.1:{port}");
            match wait_for_health(&self.http, &url, &mut service).await {
                Ok(()) => {
                    if let Some(services) = &self.macro_services {
                        services.route_document_storage(&url);
                    }
                    let proxy =
                        RecordingProxy::start(DOCUMENT_STORAGE, &url, self.recorder.clone())
                            .await?;
                    self.graphql_url = Some(format!("{}{GRAPHQL_PATH}", proxy.url()));
                    self.graphql_proxy = Some(proxy);
                    self.document_storage = Some(service);
                    return Ok(());
                }
                Err(error) if attempt < PORT_ATTEMPTS && service.log().contains("AddrInUse") => {
                    tracing::warn!(error = ?error, port, "the port was taken; trying another");
                    service.stop().await;
                }
                Err(error) => {
                    let report = error.attach(format!(
                        "the end of {}:\n{}",
                        service.log_path().display(),
                        service.log_tail()
                    ));
                    service.stop().await;
                    return Err(report);
                }
            }
        }
    }

    /// The search cluster `document_storage_service` is pointed at: the real
    /// one on a stack that searches, otherwise the stand-in that answers its
    /// health check.
    fn search_cluster_url(&self) -> String {
        self.opensearch_url
            .clone()
            .unwrap_or_else(|| self.service_url(document_storage_environment::SEARCH))
    }

    /// Starts `search_processing_service` on the scenario's database and
    /// queues, writing to the shared search cluster.
    async fn start_search_indexer(&mut self, options: &StackOptions) -> Result<(), Report> {
        crate::process::ensure_built(&[SEARCH_INDEXER])?;
        if let Some(brokers) = self.worker_env.get(KAFKA_BROKERS) {
            crate::infra::kafka::start_group_at_end(brokers, SEARCH_INDEXER_GROUP).await?;
        }

        let mut attempt = 0;
        loop {
            attempt += 1;
            let port = free_port().await?;
            let mut env = document_storage_environment::document_storage_env(
                &document_storage_environment::DocumentStorage {
                    port,
                    database_url: self.database().url(),
                    search_url: self.search_cluster_url(),
                    email_env: &self.worker_env,
                },
            );
            env.extend(document_storage_environment::search_indexer_settings());
            env.extend(options.env.iter().cloned());

            let mut service = ServiceProcess::spawn(SEARCH_INDEXER, &env, &self.log_dir)?;
            let url = format!("http://127.0.0.1:{port}");
            match wait_for_health(&self.http, &url, &mut service).await {
                Ok(()) => {
                    self.search_indexer = Some(service);
                    return Ok(());
                }
                Err(error) if attempt < PORT_ATTEMPTS && service.log().contains("AddrInUse") => {
                    tracing::warn!(error = ?error, port, "the port was taken; trying another");
                    service.stop().await;
                }
                Err(error) => {
                    let report = error.attach(format!(
                        "the end of {}:\n{}",
                        service.log_path().display(),
                        service.log_tail()
                    ));
                    service.stop().await;
                    return Err(report);
                }
            }
        }
    }

    /// Where the GraphQL API answers, when the stack serves it.
    pub(crate) fn graphql_url(&self) -> Option<String> {
        self.graphql_url.clone()
    }

    /// Starts everything that talks to the scenario's database, Redis
    /// database and queues.
    #[expect(
        clippy::too_many_arguments,
        reason = "one call site, splitting `start_with`"
    )]
    async fn boot(
        options: &StackOptions,
        servers: &environment::Servers,
        gmail: &GmailEmulator,
        outlook: &OutlookEmulator,
        database: &Database,
        redis: &RedisDatabase,
        queues: &Queues,
        log_dir: &std::path::Path,
        recorder: &Recorder,
    ) -> Result<Booted, Report> {
        let aws = Aws::start(&servers.sqs, recorder.clone()).await?;
        let macro_services = MacroServices::start(
            &gmail.base_url(),
            &outlook.base_url(),
            &format!("{}/{}", aws.url(), environment::UPLOADS_BUCKET),
        )
        .await?;

        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .context("could not build the scenario's HTTP client")?;

        let mut attempt = 0;
        let (api, tls, api_proxy, env) = loop {
            attempt += 1;
            let port = free_port().await?;
            let api_url = format!("http://127.0.0.1:{port}");
            // Everything but the health check reaches the API through the
            // proxy, Outlook's notifications included.
            let api_proxy = RecordingProxy::start(API, &api_url, recorder.clone()).await?;
            let tls = TlsFront::start(api_proxy.address()).await?;
            let mut env = environment::service_env(&environment::Addresses {
                port,
                public_url: tls.url(),
                database_url: database.url(),
                redis_url: redis.url().to_owned(),
                kafka_brokers: servers.kafka.clone(),
                aws_url: aws.url(),
                cdn_url: aws.cdn_url(),
                gmail,
                outlook,
                macro_services: &macro_services,
                queues,
            });
            env.extend(options.env.iter().cloned());

            let mut api = ServiceProcess::spawn(API, &env, log_dir)?;
            match wait_for_health(&http, &api_url, &mut api).await {
                Ok(()) => break (api, tls, api_proxy, env),
                Err(error) if attempt < PORT_ATTEMPTS && api.log().contains("AddrInUse") => {
                    tracing::warn!(error = ?error, port, "the API's port was taken; trying another");
                    api.stop().await;
                    tls.stop().await;
                    api_proxy.stop().await;
                }
                Err(error) => {
                    let report = error.attach(format!(
                        "the end of {}:\n{}",
                        api.log_path().display(),
                        api.log_tail()
                    ));
                    api.stop().await;
                    tls.stop().await;
                    api_proxy.stop().await;
                    macro_services.stop().await;
                    aws.stop().await;
                    return Err(report);
                }
            }
        };
        let workers = ServiceProcess::spawn(WORKERS, &env, log_dir)?;
        let api_url = api_proxy.url();

        Ok(Booted {
            aws,
            macro_services,
            http,
            api,
            tls,
            api_proxy,
            env,
            api_url,
            workers,
        })
    }

    /// The Gmail emulator: the provider's side of every Gmail inbox.
    pub fn gmail(&self) -> &GmailEmulator {
        &self.gmail
    }

    /// The Outlook emulator: the provider's side of every Outlook inbox.
    pub fn outlook(&self) -> &OutlookEmulator {
        &self.outlook
    }

    /// Creates the Macro user `<name>@example.com`.
    pub async fn user(&self, name: &str) -> Result<User, Report> {
        User::create(self, &format!("{name}@example.com")).await
    }

    /// Creates a Macro user `<name>-<unique>@example.com` that no other
    /// scenario and no earlier run has: for what is kept outside the
    /// scenario's own database, such as the search index.
    pub async fn unique_user(&self, name: &str) -> Result<User, Report> {
        let unique = Uuid::now_v7().simple();
        User::create(self, &format!("{name}-{unique}@example.com")).await
    }

    /// Puts mail in a mailbox at the provider before anyone links it,
    /// creating the mailbox when the provider does not have it: what a first
    /// backfill or import finds. For a linked inbox use [`Inbox::deliver`].
    pub fn seed_mailbox(
        &self,
        provider: Provider,
        address: &str,
        mail: &[Mail],
    ) -> Result<(), Report> {
        match provider {
            Provider::Gmail => {
                let known = self.gmail.mailboxes();
                if !known.iter().any(|mailbox| mailbox.email == address) {
                    self.gmail.add_mailbox(&gmail_emulator::SeedMailbox {
                        email: address.to_owned(),
                        ..Default::default()
                    })?;
                }
                for mail in mail {
                    self.gmail.deliver(address, &mail.for_gmail())?;
                }
            }
            Provider::Outlook => {
                let known = self.outlook.mailboxes();
                if !known.iter().any(|mailbox| mailbox.email == address) {
                    self.outlook.add_mailbox(&outlook_emulator::SeedMailbox {
                        email: address.to_owned(),
                        ..Default::default()
                    })?;
                }
                for mail in mail {
                    self.outlook.deliver(address, &mail.for_outlook())?;
                }
            }
        }
        Ok(())
    }

    /// The scenario's database, for fixtures and for what the API cannot
    /// answer. Prefer the API: it is what a user sees.
    pub fn db(&self) -> &PgPool {
        self.database().pool()
    }

    /// The API's base URL.
    pub fn api_url(&self) -> &str {
        &self.api_url
    }

    /// The requests the email services made to the static file service, the
    /// document storage service and the connection gateway, oldest first.
    pub fn service_requests(&self) -> Vec<ServiceRequest> {
        self.macro_services
            .as_ref()
            .map(MacroServices::requests)
            .unwrap_or_default()
    }

    /// The base URL the email services call a Macro service stand-in at.
    pub fn service_url(&self, service: &str) -> String {
        self.macro_services
            .as_ref()
            .map(|macro_services| macro_services.url(service))
            .unwrap_or_default()
    }

    /// Runs the scheduled-send sweep once, as the cron does in production:
    /// the real `email_scheduled_handler` picks the deliveries that are due
    /// or stranded and enqueues them. Returns when the sweep has finished;
    /// the workers then send what it enqueued.
    pub async fn run_scheduled_sweep(&self) -> Result<(), Report> {
        let mut env = self.worker_env.clone();
        env.insert("DATABASE_URL".to_owned(), self.database().url());
        let ran = crate::lambda::invoke_scheduled(SCHEDULED_HANDLER, &env, &self.log_dir).await;
        self.recorder.lambda_ran(SCHEDULED_HANDLER, ran.is_ok());
        ran
    }

    /// A Macro user with exactly this address, for scenarios where the
    /// address matters (a staff domain, a second address at one provider).
    pub async fn user_at(&self, address: &str) -> Result<User, Report> {
        User::create(self, address).await
    }

    /// Makes one of the Macro service stand-ins answer an error once: the
    /// next request to `service` (`static-files`, `document-storage` or
    /// `connection-gateway`) with this method whose path within the service
    /// starts with `path_prefix` answers `status`. The request is still
    /// recorded in [`Stack::service_requests`].
    pub fn fail_next_service_request(
        &self,
        service: &str,
        method: &str,
        path_prefix: &str,
        status: u16,
    ) -> Result<(), Report> {
        self.fail_next_service_request_with(
            service,
            method,
            path_prefix,
            status,
            &serde_json::json!({}),
        )
    }

    /// As [`Stack::fail_next_service_request`], answering `body` with the
    /// status: for callers that read an error code from the body.
    pub fn fail_next_service_request_with(
        &self,
        service: &str,
        method: &str,
        path_prefix: &str,
        status: u16,
        body: &serde_json::Value,
    ) -> Result<(), Report> {
        match &self.macro_services {
            Some(macro_services) => {
                macro_services.fail_next(service, method, path_prefix, status, body)
            }
            None => bail!("the stack was torn down"),
        }
    }

    /// Keeps the next request to a Macro service stand-in waiting (matched
    /// as in [`Stack::fail_next_service_request`]) until the scenario
    /// releases it, so the scenario can change things between a service's
    /// request and its answer. The request is recorded when it arrives.
    pub fn hold_next_service_request(
        &self,
        service: &str,
        method: &str,
        path_prefix: &str,
    ) -> Result<HeldRequest, Report> {
        match &self.macro_services {
            Some(macro_services) => Ok(macro_services.hold_next(service, method, path_prefix)),
            None => bail!("the stack was torn down"),
        }
    }

    /// Refuses the next `times` messages the email services send to one of
    /// their queues, with an error their AWS client does not retry: each
    /// refused send is one failed enqueue in the service. Messages the
    /// scenario sends itself are not affected.
    pub fn refuse_queue_sends(&self, queue: &str, times: usize) -> Result<(), Report> {
        let url = &self.queues().named(queue)?.url;
        match &self.aws {
            Some(aws) => aws.refuse_sends(url, times),
            None => bail!("the stack was torn down"),
        }
        Ok(())
    }

    /// How many of the refusals asked for with [`Self::refuse_queue_sends`]
    /// no send to the queue has met yet: zero once the services tried.
    pub fn queue_send_refusals_left(&self, queue: &str) -> Result<usize, Report> {
        let url = &self.queues().named(queue)?.url;
        match &self.aws {
            Some(aws) => Ok(aws.refusals_left(url)),
            None => bail!("the stack was torn down"),
        }
    }

    /// A connection to the scenario's Redis database, the one the email
    /// services use: for reading or removing what they keep there.
    pub async fn redis(&self) -> Result<redis::aio::MultiplexedConnection, Report> {
        match &self.redis {
            Some(redis) => redis.connect().await,
            None => bail!("the stack was torn down"),
        }
    }

    /// The objects the email services put in object storage.
    pub fn stored_objects(&self) -> Vec<StoredObject> {
        self.aws.as_ref().map(Aws::objects).unwrap_or_default()
    }

    /// Puts a message on one of the email queues, as a scheduled handler or
    /// another service would. Queues are named as in [`Stack::queue_names`].
    pub async fn send_to_queue(&self, queue: &str, body: &serde_json::Value) -> Result<(), Report> {
        self.queues().send(queue, body.to_string()).await
    }

    /// Takes every message waiting on a queue. Meant for the queues other
    /// services read (`notification-ingress`, `contacts`): the scenario
    /// stands in for their consumer.
    pub async fn take_queue_messages(&self, queue: &str) -> Result<Vec<serde_json::Value>, Report> {
        self.queues().take(queue).await
    }

    /// How many messages wait, are being worked on or are delayed on a queue.
    pub async fn queue_depth(&self, queue: &str) -> Result<u64, Report> {
        let queues = self.queues();
        queues.depth(&queues.named(queue)?.url).await
    }

    /// How many messages of a queue ended in its dead-letter queue.
    pub async fn dead_letters(&self, queue: &str) -> Result<u64, Report> {
        let queues = self.queues();
        queues.depth(&queues.named(queue)?.dead_letter_url).await
    }

    /// The names the queues go by in this crate: the email services', and
    /// on a stack with `document_storage` that service's own as well.
    pub fn queue_names(&self) -> Vec<&'static str> {
        self.queues().all().iter().map(|queue| queue.name).collect()
    }

    /// Everything `email_service` (the API) has logged.
    pub fn api_log(&self) -> String {
        self.api.log()
    }

    /// Everything `pubsub_workers` has logged, across restarts and while it
    /// is stopped.
    pub fn workers_log(&self) -> String {
        std::fs::read(self.log_dir.join(format!("{WORKERS}.log")))
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
            .unwrap_or_default()
    }

    /// Everything `calendar_service` has logged; empty without calendar.
    pub fn calendar_log(&self) -> String {
        self.calendar
            .as_ref()
            .map(|calendar| calendar.service.log())
            .unwrap_or_default()
    }

    /// How many calendar push notifications Google has finished delivering
    /// for the mailbox `address`.
    pub fn google_calendar_pushes(&self, address: &str) -> usize {
        self.gmail
            .channel_deliveries()
            .iter()
            .filter(|delivery| delivery.mailbox.eq_ignore_ascii_case(address))
            .count()
    }

    /// Waits until Google has delivered a calendar push for the mailbox
    /// `address` beyond the first `seen`. A change made through
    /// `calendar_service` comes back as a push that starts a sync round:
    /// wait for it, then for the round
    /// ([`Calendar::wait_until_synced`](crate::Calendar::wait_until_synced)),
    /// before changing the calendar at Google.
    pub async fn wait_for_google_calendar_push(
        &self,
        address: &str,
        seen: usize,
    ) -> Result<(), Report> {
        eventually(
            &format!("Google to push a calendar change of {address}"),
            crate::wait::DEFAULT_TIMEOUT,
            async || Ok((self.google_calendar_pushes(address) > seen).then_some(())),
        )
        .await
    }

    /// What the calendar read routes told the notification service and the
    /// connection gateway, oldest first. What `calendar_service` itself told
    /// the gateway is in [`Stack::service_requests`].
    pub fn calendar_signals(&self) -> Vec<CalendarSignal> {
        self.calendar
            .as_ref()
            .map(|calendar| calendar.reads.signals())
            .unwrap_or_default()
    }

    /// Where `calendar_service` and the calendar read routes answer, when the
    /// stack runs calendar.
    pub(crate) fn calendar_urls(&self) -> Option<(String, String)> {
        self.calendar
            .as_ref()
            .map(|calendar| (calendar.url.clone(), calendar.reads.url()))
    }

    /// Stops `pubsub_workers`: nothing syncs, sends or retries until
    /// [`Stack::start_workers`]. The API keeps answering.
    pub async fn stop_workers(&mut self) {
        if let Some(mut workers) = self.workers.take() {
            workers.stop().await;
        }
    }

    /// Starts `pubsub_workers` again after [`Stack::stop_workers`].
    pub fn start_workers(&mut self) -> Result<(), Report> {
        if self.workers.is_none() {
            self.workers = Some(ServiceProcess::spawn(
                WORKERS,
                &self.worker_env,
                &self.log_dir,
            )?);
        }
        Ok(())
    }

    /// Ends the scenario: fails when a service died or panicked, then removes
    /// everything the stack created.
    pub async fn finish(mut self) -> Result<(), Report> {
        let health = self.check_services();
        self.finished = health.is_ok();
        // Only a scenario that ended well is evidence of anything. A record
        // that cannot be written does not fail it: the coverage report
        // lists scenarios that passed and left none.
        if health.is_ok()
            && let Err(error) = self.write_evidence().await
        {
            eprintln!("email_e2e: could not write the scenario's evidence: {error}");
        }
        self.tear_down().await;
        health
    }

    pub(crate) fn recorder(&self) -> &Recorder {
        &self.recorder
    }

    /// Writes what the scenario made the services do to its log directory.
    async fn write_evidence(&self) -> Result<(), Report> {
        let links: Vec<(String, String)> = sqlx::query_as(LINKS_QUERY)
            .fetch_all(self.db())
            .await
            .context("could not read the scenario's inboxes")?;

        let gmail = self.gmail.requests().into_iter().map(|request| {
            provider_call(
                "gmail",
                request.route.map(|route| route.to_string()),
                &request.method,
                &request.path,
                request.status,
            )
        });
        let outlook = self.outlook.requests().into_iter().map(|request| {
            provider_call(
                "outlook",
                request.route.map(|route| route.to_string()),
                &request.method,
                &request.path,
                request.status,
            )
        });
        let provider = counted(gmail.chain(outlook));

        let services = counted(self.service_requests().iter().map(|request| {
            serde_json::json!({
                "service": request.service,
                "method": request.method,
                "path": path_shape(&request.path),
                "body": request.body.as_ref().map(shape),
            })
        }));

        let brokers = self
            .worker_env
            .get(KAFKA_BROKERS)
            .cloned()
            .unwrap_or_default();
        let published =
            crate::infra::kafka::published_since(&brokers, EMAIL_EVENTS, self.event_starts.clone())
                .await?;
        // The topic is every scenario's: an event is this one's when it is
        // about one of its inboxes.
        let kafka = counted(published.iter().filter_map(|payload| {
            let event: serde_json::Value = serde_json::from_slice(payload).ok()?;
            let link_id = event["metadata"]["link_id"].as_str()?;
            links
                .iter()
                .any(|(_, id)| id == link_id)
                .then(|| serde_json::json!({ "topic": EMAIL_EVENTS, "event": event["event_type"] }))
        }));

        let queue_names = self
            .queues()
            .all()
            .iter()
            .flat_map(|queue| {
                [
                    (queue.url.clone(), queue.name.to_owned()),
                    (
                        queue.dead_letter_url.clone(),
                        format!("{}{DEAD_LETTER_SUFFIX}", queue.name),
                    ),
                ]
            })
            .collect();
        self.recorder.write(
            &self.log_dir,
            &queue_names,
            Collected {
                links,
                provider,
                kafka,
                services,
            },
        )
    }

    pub(crate) fn http(&self) -> &reqwest::Client {
        &self.http
    }

    pub(crate) fn internal_api_key(&self) -> &str {
        &self.internal_api_key
    }

    /// Fails when a service is no longer running, with the end of its log.
    pub(crate) fn ensure_running(&mut self) -> Result<(), Report> {
        if let Some(redis) = &self.redis {
            redis.ensure_held()?;
        }
        self.api.ensure_running()?;
        if let Some(workers) = &mut self.workers {
            workers.ensure_running()?;
        }
        if let Some(document_storage) = &mut self.document_storage {
            document_storage.ensure_running()?;
        }
        if let Some(search_indexer) = &mut self.search_indexer {
            search_indexer.ensure_running()?;
        }
        if let Some(calendar) = &mut self.calendar {
            calendar.service.ensure_running()?;
        }
        Ok(())
    }

    fn check_services(&mut self) -> Result<(), Report> {
        self.ensure_running()?;
        let document_storage = self
            .document_storage
            .as_ref()
            .map(ServiceProcess::log)
            .unwrap_or_default();
        let search_indexer = self
            .search_indexer
            .as_ref()
            .map(ServiceProcess::log)
            .unwrap_or_default();
        for (name, log) in [
            (API, self.api_log()),
            (WORKERS, self.workers_log()),
            (DOCUMENT_STORAGE, document_storage),
            (SEARCH_INDEXER, search_indexer),
            (CALENDAR, self.calendar_log()),
        ] {
            if let Some(line) = log.lines().find(|line| line.contains(PANIC_MARKER)) {
                bail!(
                    "{name} panicked during the scenario: {line}\nfull log: {}",
                    self.log_dir.join(format!("{name}.log")).display()
                );
            }
        }
        Ok(())
    }

    fn database(&self) -> &Database {
        match &self.database {
            Some(database) => database,
            // Only `tear_down` takes it, and that consumes the stack's use.
            None => unreachable!("the scenario database is used after the stack was torn down"),
        }
    }

    pub(crate) fn queues(&self) -> &Queues {
        match &self.queues {
            Some(queues) => queues,
            None => unreachable!("the scenario queues are used after the stack was torn down"),
        }
    }

    /// Stops the services and removes the database, the queues and the Redis
    /// lease.
    async fn tear_down(&mut self) {
        self.api.stop().await;
        // Told to stop rather than killed: it leaves its consumer group, so
        // the next scenario's indexer is not kept waiting for this one's
        // session to expire.
        if let Some(mut search_indexer) = self.search_indexer.take() {
            search_indexer.stop_gracefully().await;
        }
        if let Some(mut document_storage) = self.document_storage.take() {
            document_storage.stop().await;
        }
        if let Some(mut workers) = self.workers.take() {
            workers.stop().await;
        }
        if let Some(mut calendar) = self.calendar.take() {
            calendar.service.stop().await;
            calendar.reads.stop().await;
        }
        if let Some(tls) = self.tls.take() {
            tls.stop().await;
        }
        for proxy in [self.api_proxy.take(), self.graphql_proxy.take()]
            .into_iter()
            .flatten()
        {
            proxy.stop().await;
        }
        if let Some(macro_services) = self.macro_services.take() {
            macro_services.stop().await;
        }
        if let Some(aws) = self.aws.take() {
            aws.stop().await;
        }
        if let Some(queues) = self.queues.take() {
            queues.delete().await;
        }
        if let Some(redis) = self.redis.take() {
            redis.release().await;
        }
        if let Some(database) = self.database.take()
            && let Err(error) = database.drop_database().await
        {
            tracing::warn!(error = ?error, "could not drop the scenario database");
        }
    }

    /// What a failed scenario prints: where the logs are and how they end.
    fn failure_report(&self) -> String {
        let mut report = format!(
            "\n--- email_e2e: the scenario failed; service logs are in {} ---\n",
            self.log_dir.display()
        );
        let others = self
            .workers
            .iter()
            .chain(&self.document_storage)
            .chain(&self.search_indexer)
            .chain(self.calendar.as_ref().map(|calendar| &calendar.service));
        for process in std::iter::once(&self.api).chain(others) {
            report.push_str(&format!(
                "--- the end of {} ---\n{}\n",
                process.log_path().display(),
                process.log_tail()
            ));
        }
        report
    }
}

impl Drop for Stack {
    /// A scenario that failed, by an error or a panic, never reached
    /// [`Stack::finish`]: say where its logs are and still remove what the
    /// stack created, so failures do not pile up databases and queues.
    fn drop(&mut self) {
        if self.finished {
            return;
        }
        eprintln!("{}", self.failure_report());
        if self.database.is_none() && self.queues.is_none() {
            return;
        }
        // The teardown waits on tasks of the scenario's runtime, which a
        // single-threaded one cannot run while this thread is blocked here.
        let single_threaded = tokio::runtime::Handle::try_current().is_ok_and(|runtime| {
            runtime.runtime_flavor() == tokio::runtime::RuntimeFlavor::CurrentThread
        });
        if single_threaded {
            eprintln!(
                "email_e2e: the scenario's database and queues are left behind: \
                 use #[tokio::test(flavor = \"multi_thread\")]"
            );
            return;
        }

        // `drop` cannot await, and the scenario's own runtime may be the one
        // unwinding, so the cleanup runs to its end on a thread of its own.
        std::thread::scope(|scope| {
            scope.spawn(|| {
                let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                else {
                    return;
                };
                runtime.block_on(self.tear_down());
            });
        });
    }
}

/// Starts `calendar_service` and the calendar read routes next to the email
/// services.
async fn start_calendar(
    http: &reqwest::Client,
    email_env: &BTreeMap<String, String>,
    app_url: &str,
    overrides: &[(String, String)],
    db: &PgPool,
    log_dir: &std::path::Path,
) -> Result<CalendarPart, Report> {
    let mut attempt = 0;
    let (service, port, env) = loop {
        attempt += 1;
        let port = free_port().await?;
        let env = calendar_environment::calendar_env(email_env, port, app_url, overrides);
        let mut service = ServiceProcess::spawn(CALENDAR, &env, log_dir)?;
        match wait_for_health(http, &format!("http://127.0.0.1:{port}"), &mut service).await {
            Ok(()) => break (service, port, env),
            Err(error) if attempt < PORT_ATTEMPTS && service.log().contains("AddrInUse") => {
                tracing::warn!(error = ?error, port, "the calendar service's port was taken; trying another");
                service.stop().await;
            }
            Err(error) => return Err(error),
        }
    };

    let team_sharing = env
        .get(calendar_environment::TEAM_SHARING)
        .is_some_and(|value| value == "true");
    let reads =
        CalendarReads::start(db.clone(), environment::INTERNAL_API_KEY, team_sharing).await?;
    Ok(CalendarPart {
        service,
        url: calendar_environment::gateway_url(port),
        reads,
    })
}

/// What [`Stack::boot`] started.
struct Booted {
    aws: Aws,
    macro_services: MacroServices,
    http: reqwest::Client,
    api: ServiceProcess,
    tls: TlsFront,
    api_proxy: RecordingProxy,
    env: BTreeMap<String, String>,
    api_url: String,
    workers: ServiceProcess,
}

/// Gives back what a stack that failed to start had created.
async fn discard(database: Database, redis: Option<RedisDatabase>, queues: Option<Queues>) {
    if let Some(queues) = queues {
        queues.delete().await;
    }
    if let Some(redis) = redis {
        redis.release().await;
    }
    if let Err(error) = database.drop_database().await {
        tracing::warn!(error = ?error, "could not drop the scenario database");
    }
}

/// One provider call as the evidence keeps it: by the API method the
/// emulator matched it to, or by its method and path when it matched none.
fn provider_call(
    provider: &str,
    route: Option<String>,
    method: &str,
    path: &str,
    status: u16,
) -> serde_json::Value {
    let unmatched = route.is_none().then(|| path_shape(path));
    serde_json::json!({
        "provider": provider,
        "route": route,
        "method": method,
        "path": unmatched,
        "status": status,
    })
}

/// Waits until the API answers its health check, failing at once when the
/// process exits. Another scenario's listener can take the port between its
/// choice and the API binding it, and would answer the request, so the API
/// must also have logged that it is serving.
async fn wait_for_health(
    http: &reqwest::Client,
    api_url: &str,
    api: &mut ServiceProcess,
) -> Result<(), Report> {
    let health = format!("{api_url}/health");
    eventually(
        "the service to answer /health",
        STARTUP_TIMEOUT,
        async || {
            api.ensure_running()?;
            let healthy = http
                .get(&health)
                .send()
                .await
                .is_ok_and(|response| response.status().is_success());
            Ok((healthy && api.log().contains(SERVING_MARKER)).then_some(()))
        },
    )
    .await
}

/// A port nothing listens on right now.
async fn free_port() -> Result<u16, Report> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .context("could not find a free port for the API")?;
    Ok(listener.local_addr()?.port())
}

/// The directory the scenario's service logs go to: one per scenario, named
/// after the test, under `email-e2e/` next to the service binaries.
fn log_dir(id: &str) -> Result<PathBuf, Report> {
    let thread = std::thread::current();
    let test = thread
        .name()
        .unwrap_or("scenario")
        .replace(|character: char| !character.is_ascii_alphanumeric(), "_");
    let suffix = id.get(id.len().saturating_sub(8)..).unwrap_or(id);
    let dir = crate::process::binary_dir()?
        .join("email-e2e")
        .join(format!("{test}-{suffix}"));
    std::fs::create_dir_all(&dir).context("could not create the scenario's log directory")?;
    Ok(dir)
}
