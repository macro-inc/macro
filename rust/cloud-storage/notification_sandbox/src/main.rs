mod adapters;
mod interactive;
mod sandbox_notification;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use email_formatting::EmailDigestNotification;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use model_notifications::ChannelMessageSendMetadata;
use notification::domain::models::email_notification_digest::ports::MessageId;
use notification::domain::models::email_notification_digest::{
    EmailBlockList, ExplicitInviteAllowList, NotificationSetBuilder, StateMachineDecisionC,
    StateMachineDriverA, StateMachineDriverB, StateMachineDriverC,
};
use notification::domain::models::{DeviceEndpoint, SendNotificationRequestBuilder};
use notification::domain::ports::NotificationEgress;
use notification::domain::service::{
    NotificationEgressService, NotificationIngress, NotificationIngressService,
};
use notification::outbound::digest_batcher::RedisDigestBatcher;
use notification::outbound::email::EmailAdapter;
use notification::outbound::message_receipt_repository::DbMessageReceiptRepository;
use notification::outbound::mobile::MobilePushAdapter;
use notification::outbound::repository::DbNotificationRepository;
use rootcause::Report;
use sandbox_notification::{NeverMatchNotification, SandboxNotification};
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

use adapters::interactive_mobile::{
    InteractiveMobileSender, PushPromptRequest, SandboxMobileSender,
};
use adapters::logging_websocket::LoggingWebSocketSender;
use adapters::mpsc_queue::MpscQueue;
use adapters::noop_rate_limiter::NoOpRateLimiter;
use adapters::sandbox_repository::SandboxNotificationRepository;

/// Configuration collected from the interactive wizard.
struct SandboxConfig {
    digest_window: Duration,
    online_threshold: Duration,
    is_blocked: bool,
    is_invite: bool,
    sns_mode: SnsMode,
    num_endpoints: usize,
}

enum SnsMode {
    Mock,
    Real {
        sns_client: aws_sdk_sns::Client,
        endpoint_arn: String,
    },
}

#[tokio::main]
async fn main() -> Result<(), Report> {
    tracing_subscriber::fmt::init();

    tokio::spawn(async {
        tokio::signal::ctrl_c().await.ok();
        std::process::exit(0);
    });

    println!("\n=== Notification Digest Sandbox ===\n");

    // --- Phase 1: Connect to persistence ---
    let default_db = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://user:password@localhost:5432/macrodb".to_string());
    let database_url = inquire::Text::new("Postgres URL?")
        .with_default(&default_db)
        .prompt()?;

    let default_redis =
        std::env::var("REDIS_URI").unwrap_or_else(|_| "redis://localhost:6379".to_string());
    let redis_uri = inquire::Text::new("Redis URL?")
        .with_default(&default_redis)
        .prompt()?;

    let db = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;
    println!("Connected to Postgres.");

    let redis_client = redis::Client::open(redis_uri.as_str())?;
    let redis_conn = redis_client.get_multiplexed_async_connection().await?;
    println!("Connected to Redis.\n");

    // --- Phase 2: Configuration wizard ---
    let config = run_config_wizard().await?;

    // --- Wire up services ---
    let user_email = inquire::Text::new("Recipient email?")
        .with_default("sandbox-user@test.com")
        .prompt()?;
    let user_id = MacroUserIdStr::try_from_email(&user_email)?;

    let queue = MpscQueue::new();

    // Build sandbox device endpoints from config
    let device_endpoints = build_device_endpoints(&user_id, &config);
    let sandbox_repo = SandboxNotificationRepository::new(
        DbNotificationRepository::new(db.clone()),
        device_endpoints,
    );

    // Ingress: StateMachineDriverA with interactive checkers
    let block_list = if config.is_blocked {
        EmailBlockList::new::<SandboxNotification>()
    } else {
        EmailBlockList::new::<NeverMatchNotification>()
    };

    let invite_list = if config.is_invite {
        ExplicitInviteAllowList::new::<SandboxNotification>()
    } else {
        ExplicitInviteAllowList::new::<NeverMatchNotification>()
    };

    let state_machine_a = StateMachineDriverA {
        user_checker: interactive::user_existence::InteractiveUserExistenceChecker,
        notification_checker: interactive::push_checker::InteractivePushNotificationChecker,
        online_checker: interactive::last_online::InteractiveLastOnlineChecker,
        digest_batcher: RedisDigestBatcher::new(redis_conn.clone()),
        block_list,
        invite_list,
        digest_window: config.digest_window,
        online_duration_threshold: config.online_threshold,
    };

    let ingress_service =
        NotificationIngressService::new(sandbox_repo, queue.clone(), state_machine_a);

    // Egress: interactive mobile push, SES email, real state machine B
    let aws_config = macro_aws_config::get_macro_aws_config().await;
    let (prompt_tx, mut prompt_rx) = tokio::sync::mpsc::unbounded_channel::<PushPromptRequest>();
    let mobile_sender = match &config.sns_mode {
        SnsMode::Mock => SandboxMobileSender::Interactive(InteractiveMobileSender { prompt_tx }),
        SnsMode::Real {
            sns_client,
            endpoint_arn: _,
        } => SandboxMobileSender::Real(MobilePushAdapter::new(
            sns_client.clone(),
            "com.macro.app.prod".to_string(),
        )),
    };
    let email_adapter = EmailAdapter::new(
        aws_sdk_sesv2::Client::new(&aws_config),
        "notif-sandbox@macro.com".to_string(),
    );

    let egress_service = Arc::new(NotificationEgressService {
        queue: queue.clone(),
        repository: DbNotificationRepository::new(db.clone()),
        websocket: LoggingWebSocketSender,
        mobile: mobile_sender,
        email: email_adapter,
        rate_limiter: NoOpRateLimiter,
        state_machine: StateMachineDriverB {
            message_receipt_repo: DbMessageReceiptRepository::new(db.clone()),
            digest_batcher: RedisDigestBatcher::new(redis_conn.clone()),
            digest_window: config.digest_window,
        },
        digest_batcher: RedisDigestBatcher::new(redis_conn.clone()),
    });

    // Shared log buffer so background egress output doesn't corrupt inquire prompts
    let egress_log: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));

    // Spawn background egress loop to continuously deliver queued messages
    let egress_bg = egress_service.clone();
    let egress_log_bg = egress_log.clone();
    tokio::spawn(async move {
        loop {
            let results = egress_bg.poll_and_deliver().await;
            if !results.is_empty() {
                let mut log = egress_log_bg.lock().unwrap();
                for result in &results {
                    match result {
                        Ok(success) => log.push(format!("  [egress] SUCCESS ({success:?})")),
                        Err(e) => log.push(format!("  [egress] FAILED ({e})")),
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    });

    // StateMachineC for interactive SNS failure reconciliation
    let state_machine_c = StateMachineDriverC {
        message_receipt_repo: DbMessageReceiptRepository::new(db.clone()),
        digest_batcher: RedisDigestBatcher::new(redis_conn.clone()),
        notif_repo: DbNotificationRepository::new(db.clone()),
        digest_window: config.digest_window,
    };

    println!("\nServices wired up. Entering interactive loop.\n");

    // --- Interactive loop ---
    loop {
        // Drain buffered egress log and handle any stale push prompts
        drain_egress_log(&egress_log);
        handle_pending_prompts(&mut prompt_rx);
        drain_egress_log(&egress_log);

        let action = inquire::Select::new(
            "What would you like to do?",
            vec![
                "Create and send a notification",
                "Run StateMachineC (SNS failure reconciliation)",
                "Poll digest status",
                "Quit",
            ],
        )
        .prompt()?;

        match action {
            "Create and send a notification" => {
                run_notification_cycle(&user_id, &ingress_service).await?;
                // Handle push prompts from the background egress task until it's done
                drain_push_prompts(&mut prompt_rx, &egress_log).await;
            }
            "Run StateMachineC (SNS failure reconciliation)" => {
                run_state_machine_c(&state_machine_c).await?;
            }
            "Poll digest status" => {
                poll_email_digests(&*egress_service).await?;
            }
            "Quit" => break,
            _ => unreachable!(),
        }

        drain_egress_log(&egress_log);
        println!();
    }

    println!("\nSandbox complete.");
    Ok(())
}

/// Print any buffered egress log lines.
fn drain_egress_log(log: &Arc<Mutex<Vec<String>>>) {
    let lines: Vec<String> = log.lock().unwrap().drain(..).collect();
    for line in lines {
        println!("{line}");
    }
}

/// Handle any push-prompt requests already queued (non-blocking).
fn handle_pending_prompts(rx: &mut tokio::sync::mpsc::UnboundedReceiver<PushPromptRequest>) {
    while let Ok(req) = rx.try_recv() {
        prompt_push_result(req);
    }
}

/// Wait for push prompts from the background egress task until it's idle.
///
/// After ingress publishes to the queue, the background egress picks it up and may send
/// multiple push prompt requests (one per endpoint). We wait for each one, answer it,
/// and continue until no more arrive within a short timeout.
async fn drain_push_prompts(
    rx: &mut tokio::sync::mpsc::UnboundedReceiver<PushPromptRequest>,
    egress_log: &Arc<Mutex<Vec<String>>>,
) {
    while let Ok(Some(req)) = tokio::time::timeout(Duration::from_secs(2), rx.recv()).await {
        prompt_push_result(req);
        drain_egress_log(egress_log);
    }
}

/// Show an interactive prompt for a single push result and send the reply.
fn prompt_push_result(req: PushPromptRequest) {
    let succeeded =
        inquire::Confirm::new(&format!("Did push to \"{}\" succeed?", req.endpoint_arn))
            .with_default(true)
            .prompt()
            .unwrap_or(false);

    if succeeded {
        println!("  -> SUCCESS (message_id: {})", req.message_id);
    } else {
        println!("  -> FAILED");
    }

    let _ = req.reply.send(succeeded);
}

/// Create a notification via the ingress service. The background egress task delivers it.
async fn run_notification_cycle<I: NotificationIngress>(
    user_id: &MacroUserIdStr<'static>,
    ingress: &I,
) -> Result<(), Report> {
    println!("\n--- Ingress: Creating notification ---\n");

    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Channel.with_entity_str("sandbox-entity-id"),
        notification: ChannelMessageSendMetadata {
            sender: MacroUserIdStr::try_from_email("fake-user@example.com").unwrap(),
            message_content: "This is a message".to_string(),
            message_id: "message_id".to_string(),
            common: model_notifications::CommonChannelMetadata {
                channel_type: model_notifications::ChannelType::Public,
                channel_name: "test-channel-name".to_string(),
            },
        },
        sender_id: None,
        recipient_ids: HashSet::from([user_id.copied()]),
    }
    .into_request()
    .with_apns();

    match ingress.send_notification(request).await {
        Ok(Some(result)) => {
            println!(
                "\nIngress complete: notification {} created for {} recipient(s). Published to queue.",
                result.notification_id,
                result.notified_recipients.len()
            );
        }
        Ok(None) => {
            println!("\nIngress: no recipients remaining after filtering.");
        }
        Err(e) => {
            println!("\nIngress failed: {e}");
        }
    }

    Ok(())
}

/// Interactively run StateMachineC to simulate SNS delivery failure.
async fn run_state_machine_c(
    state_machine_c: &StateMachineDriverC<
        RedisDigestBatcher,
        DbMessageReceiptRepository,
        DbNotificationRepository<PgPool>,
    >,
) -> Result<(), Report> {
    println!("\n--- StateMachineC: SNS Failure Reconciliation ---\n");

    let msg_id = inquire::Text::new("Enter SNS message ID to mark as failed (from egress output):")
        .prompt()?;

    if msg_id.trim().is_empty() {
        println!("  Skipped (empty message ID).");
        return Ok(());
    }

    match state_machine_c
        .mark_message_as_failed(MessageId(msg_id.clone()))
        .await
    {
        Ok(StateMachineDecisionC::NoAction) => {
            println!("  -> NoAction (not all endpoints have failed yet)");
        }
        Ok(StateMachineDecisionC::BatchWasQueued(_)) => {
            println!("  -> BatchWasQueued! (all endpoints failed, added to digest)");
        }
        Err(e) => {
            println!("  -> Error: {e}");
        }
    }

    Ok(())
}

/// Poll for ready digest batches via the egress service.
async fn poll_email_digests(egress: &impl NotificationEgress) -> Result<(), Report> {
    println!("\n--- Poll Email Digests ---\n");

    fn digest_to_sandbox(
        batch: notification::domain::models::email_notification_digest::ports::DigestBatch,
    ) -> Result<SandboxNotification, Report> {
        Ok(SandboxNotification {
            inner: EmailDigestNotification::new_from_digest_batch(batch)?,
        })
    }

    let res = egress.poll_email_digests(digest_to_sandbox).await?;
    println!("{res:?}");
    Ok(())
}

/// Build sandbox device endpoints based on the config wizard.
fn build_device_endpoints(
    user_id: &MacroUserIdStr<'static>,
    config: &SandboxConfig,
) -> HashMap<MacroUserIdStr<'static>, Vec<DeviceEndpoint>> {
    let endpoints: Vec<DeviceEndpoint> = match &config.sns_mode {
        SnsMode::Mock => (1..=config.num_endpoints)
            .map(|i| {
                DeviceEndpoint::Ios(format!(
                    "arn:aws:sns:sandbox:000:endpoint/APNS/sandbox/endpoint-{i}"
                ))
            })
            .collect(),
        SnsMode::Real { endpoint_arn, .. } => {
            if config.num_endpoints == 1 {
                vec![DeviceEndpoint::Ios(endpoint_arn.clone())]
            } else {
                (1..=config.num_endpoints)
                    .map(|i| {
                        let arn = inquire::Text::new(&format!("Endpoint ARN for endpoint-{i}?"))
                            .with_default(endpoint_arn)
                            .prompt()
                            .expect("prompt failed");
                        DeviceEndpoint::Ios(arn)
                    })
                    .collect()
            }
        }
    };

    HashMap::from([(user_id.clone().into_owned(), endpoints)])
}

async fn run_config_wizard() -> Result<SandboxConfig, Report> {
    let digest_minutes: u64 = inquire::CustomType::new("Digest window (minutes)?")
        .with_default(30)
        .prompt()?;

    let online_minutes: u64 = inquire::CustomType::new("Online duration threshold (minutes)?")
        .with_default(5)
        .prompt()?;

    let is_blocked = inquire::Confirm::new("Is this notification type blocked from email?")
        .with_default(false)
        .prompt()?;

    let is_invite = inquire::Confirm::new("Is this notification type an invite?")
        .with_default(false)
        .prompt()?;

    let sns_options = vec!["Mock (interactive)", "Real (AWS)"];
    let sns_choice = inquire::Select::new("SNS mode?", sns_options).prompt()?;

    let sns_mode = if sns_choice == "Real (AWS)" {
        let endpoint_arn = inquire::Text::new("SNS endpoint ARN?").prompt()?;
        let aws_config = macro_aws_config::get_macro_aws_config().await;
        SnsMode::Real {
            sns_client: aws_sdk_sns::Client::new(&aws_config),
            endpoint_arn,
        }
    } else {
        SnsMode::Mock
    };

    let num_endpoints: usize = inquire::CustomType::new("Number of iOS endpoints for user?")
        .with_default(2usize)
        .prompt()?;

    Ok(SandboxConfig {
        digest_window: Duration::from_secs(digest_minutes * 60),
        online_threshold: Duration::from_secs(online_minutes * 60),
        is_blocked,
        is_invite,
        sns_mode,
        num_endpoints,
    })
}
