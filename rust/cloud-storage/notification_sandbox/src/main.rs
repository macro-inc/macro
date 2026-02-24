mod adapters;
mod interactive;
mod sandbox_notification;

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
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

use adapters::interactive_mobile::{InteractiveMobileSender, SandboxMobileSender};
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
    let mobile_sender = match &config.sns_mode {
        SnsMode::Mock => SandboxMobileSender::Interactive(InteractiveMobileSender),
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

    let egress_service = NotificationEgressService {
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
    };

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
                run_notification_cycle(&user_id, &ingress_service, &egress_service).await?;
            }
            "Run StateMachineC (SNS failure reconciliation)" => {
                run_state_machine_c(&state_machine_c).await?;
            }
            "Poll digest status" => {
                poll_email_digests(&egress_service).await?;
            }
            "Quit" => break,
            _ => unreachable!(),
        }

        println!();
    }

    println!("\nSandbox complete.");
    Ok(())
}

/// Create a notification via the ingress service, then deliver via the egress service.
async fn run_notification_cycle<I, E>(
    user_id: &MacroUserIdStr<'static>,
    ingress: &I,
    egress: &E,
) -> Result<(), Report>
where
    I: NotificationIngress,
    E: NotificationEgress,
{
    println!("\n--- Ingress: Creating notification ---\n");

    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Channel.with_entity_str("sandbox-entity-id"),
        notification: SandboxNotification {
            message: "Sandbox test notification".to_string(),
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
            return Ok(());
        }
        Err(e) => {
            println!("\nIngress failed: {e}");
            return Ok(());
        }
    }

    // Now process the queued message via the egress service
    println!("\n--- Egress: Delivering notification ---\n");

    let results = egress.poll_and_deliver().await;

    if results.is_empty() {
        println!("  No messages in queue to deliver.");
    } else {
        println!("\nDelivery results:");
        for (i, result) in results.iter().enumerate() {
            match result {
                Ok(success) => println!("  {}: SUCCESS ({success:?})", i + 1),
                Err(e) => println!("  {}: FAILED ({e})", i + 1),
            }
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
            message: format!(
                "You have {} new notification(s) \n\n {:#?}",
                batch.notifications.len(),
                batch
            ),
        })
    }

    egress.poll_email_digests(digest_to_sandbox).await?;
    println!("Done.");
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
