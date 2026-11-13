//! One scenario's world: both provider emulators, the scenario's own
//! database, Redis database and queues, and the real `email_service` and
//! `pubsub_workers` binaries running against them.

mod calendar_environment;
mod calendar_reads;
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

pub use self::calendar_reads::CalendarSignal;
use self::calendar_reads::CalendarReads;
use crate::aws::{Aws, StoredObject};
use crate::inbox::{Mail, Provider};
use crate::infra::postgres::Database;
use crate::infra::redis::RedisDatabase;
use crate::infra::sqs::Queues;
use crate::macro_services::{MacroServices, ServiceRequest};
use crate::process::ServiceProcess;
use crate::tls::TlsFront;
use crate::user::User;
use crate::wait::eventually;

/// The API binary.
const API: &str = "email_service";
/// The binary that runs the queue workers and the Outlook mailbox loops.
const WORKERS: &str = "pubsub_workers";
/// The calendar service's binary.
const CALENDAR: &str = "calendar_service";
/// The stand-in for the app service, which calendar scheduling names in
/// meeting links.
const APP: &str = "app";
/// How long the API gets to answer its health check.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(120);
/// How often the API is started again on another port when the one picked
/// for it was taken in between.
const PORT_ATTEMPTS: u8 = 3;
/// What a Rust process writes when a thread panics.
const PANIC_MARKER: &str = "panicked at";

/// How a stack differs from the default one.
#[derive(Clone, Debug, Default)]
pub struct StackOptions {
    /// Environment variables for both services, set after the stack's own,
    /// so they can replace them.
    pub env: Vec<(String, String)>,
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
    api: ServiceProcess,
    workers: Option<ServiceProcess>,
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

        let database = Database::create(&servers.postgres).await?;
        let redis = RedisDatabase::lease(&servers.redis).await?;
        let queue_prefix = format!("e2e-{id}");
        let mut queues = Queues::create(&servers.sqs, &queue_prefix).await?;
        if options.calendar {
            queues.add_calendar_backfill(&queue_prefix).await?;
        }
        let aws = Aws::start(&servers.sqs).await?;
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
        let (api, tls, env, api_url) = loop {
            attempt += 1;
            let port = free_port().await?;
            let tls = TlsFront::start(SocketAddr::from(([127, 0, 0, 1], port))).await?;
            let mut env = environment::service_env(&environment::Addresses {
                port,
                public_url: tls.url(),
                database_url: database.url(),
                redis_url: redis.url().to_owned(),
                kafka_brokers: servers.kafka.clone(),
                aws_url: aws.url(),
                cdn_url: aws.cdn_url(),
                gmail: &gmail,
                outlook: &outlook,
                macro_services: &macro_services,
                queues: &queues,
            });
            env.extend(options.env.iter().cloned());

            let mut api = ServiceProcess::spawn(API, &env, &log_dir)?;
            let api_url = format!("http://127.0.0.1:{port}");
            match wait_for_health(&http, &api_url, &mut api).await {
                Ok(()) => break (api, tls, env, api_url),
                Err(error) if attempt < PORT_ATTEMPTS && api.log().contains("AddrInUse") => {
                    tracing::warn!(error = ?error, port, "the API's port was taken; trying another");
                    api.stop().await;
                    tls.stop().await;
                }
                Err(error) => return Err(error),
            }
        };
        gmail.set_push(Some(PushConfig::new(format!("{api_url}/gmail/webhook"))));
        let workers = ServiceProcess::spawn(WORKERS, &env, &log_dir)?;
        let calendar = if options.calendar {
            let app_url = macro_services.url(APP);
            Some(
                start_calendar(&http, &env, &app_url, &options.env, database.pool(), &log_dir)
                    .await?,
            )
        } else {
            None
        };

        Ok(Self {
            gmail,
            outlook,
            database: Some(database),
            redis: Some(redis),
            queues: Some(queues),
            aws: Some(aws),
            macro_services: Some(macro_services),
            tls: Some(tls),
            api,
            workers: Some(workers),
            calendar,
            worker_env: env,
            api_url,
            internal_api_key: environment::INTERNAL_API_KEY.to_owned(),
            http,
            log_dir,
            finished: false,
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

    /// The names the queues go by in this crate.
    pub fn queue_names(&self) -> Vec<&'static str> {
        self.queues().all().iter().map(|queue| queue.name).collect()
    }

    /// Everything `email_service` (the API) has logged.
    pub fn api_log(&self) -> String {
        self.api.log()
    }

    /// Everything `pubsub_workers` has logged since it last started.
    pub fn workers_log(&self) -> String {
        self.workers
            .as_ref()
            .map(ServiceProcess::log)
            .unwrap_or_default()
    }

    /// Everything `calendar_service` has logged; empty without calendar.
    pub fn calendar_log(&self) -> String {
        self.calendar
            .as_ref()
            .map(|calendar| calendar.service.log())
            .unwrap_or_default()
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
        self.tear_down().await;
        health
    }

    pub(crate) fn http(&self) -> &reqwest::Client {
        &self.http
    }

    pub(crate) fn internal_api_key(&self) -> &str {
        &self.internal_api_key
    }

    /// Fails when a service is no longer running, with the end of its log.
    pub(crate) fn ensure_running(&mut self) -> Result<(), Report> {
        self.api.ensure_running()?;
        if let Some(workers) = &mut self.workers {
            workers.ensure_running()?;
        }
        if let Some(calendar) = &mut self.calendar {
            calendar.service.ensure_running()?;
        }
        Ok(())
    }

    fn check_services(&mut self) -> Result<(), Report> {
        self.ensure_running()?;
        for (name, log) in [
            (API, self.api_log()),
            (WORKERS, self.workers_log()),
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

    fn queues(&self) -> &Queues {
        match &self.queues {
            Some(queues) => queues,
            None => unreachable!("the scenario queues are used after the stack was torn down"),
        }
    }

    /// Stops the services and removes the database, the queues and the Redis
    /// lease.
    async fn tear_down(&mut self) {
        self.api.stop().await;
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
        let workers = self.workers.as_ref();
        let calendar = self.calendar.as_ref().map(|calendar| &calendar.service);
        for process in std::iter::once(&self.api).chain(workers).chain(calendar) {
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
    let reads = CalendarReads::start(db.clone(), environment::INTERNAL_API_KEY, team_sharing).await?;
    Ok(CalendarPart {
        service,
        url: calendar_environment::gateway_url(port),
        reads,
    })
}

/// Waits until a service answers its health check, failing at once when the
/// process exits.
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
            Ok(healthy.then_some(()))
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
