mod interactive;
mod sandbox_notification;

use std::collections::HashSet;
use std::time::Duration;

use anyhow::Context;
use either::Either;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use notification::domain::models::SendNotificationRequestBuilder;
use notification::domain::models::email_notification_digest::ports::{
    ClaimResult, DigestBatcher, MessageId, NotificationSendChecker,
};
use notification::domain::models::email_notification_digest::{
    EmailBlockList, ExplicitInviteAllowList, NotificationSetBuilder, ResumeMachineBRequest,
    StateMachineDecisionA, StateMachineDecisionC, StateMachineDriverA, StateMachineDriverB,
    StateMachineDriverC,
};
use notification::domain::ports::NotificationRepository;
use notification::outbound::digest_batcher::RedisDigestBatcher;
use notification::outbound::message_receipt_repository::DbMessageReceiptRepository;
use notification::outbound::repository::DbNotificationRepository;
use rootcause::Report;
use sandbox_notification::{NeverMatchNotification, SandboxNotification};
use sqlx::postgres::PgPoolOptions;

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

/// Wraps both mock and real push attempts into a single type.
enum PushAttempt {
    Mock(interactive::push_attempt::InteractivePushAttempt),
    Real(interactive::real_push_attempt::RealSnsPushAttempt),
}

impl NotificationSendChecker for PushAttempt {
    type Ok = String;
    type Err = Report;

    async fn send_notification(self) -> Result<String, Report> {
        match self {
            PushAttempt::Mock(m) => m.send_notification().await,
            PushAttempt::Real(r) => r.send_notification().await,
        }
    }

    fn extract_message_id(res: &String) -> MessageId {
        MessageId(res.clone())
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    println!("\n=== Notification Digest Sandbox ===\n");

    // --- Phase 1: Connect to persistence ---
    let default_db = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://user:password@localhost:5432/macrodb".to_string());
    let database_url = inquire::Text::new("Postgres URL?")
        .with_default(&default_db)
        .prompt()
        .context("prompt failed")?;

    let default_redis =
        std::env::var("REDIS_URI").unwrap_or_else(|_| "redis://localhost:6379".to_string());
    let redis_uri = inquire::Text::new("Redis URL?")
        .with_default(&default_redis)
        .prompt()
        .context("prompt failed")?;

    let db = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .context("failed to connect to Postgres")?;
    println!("Connected to Postgres.");

    let redis_client =
        redis::Client::open(redis_uri.as_str()).context("failed to create Redis client")?;
    let redis_conn = redis_client
        .get_multiplexed_async_connection()
        .await
        .context("failed to connect to Redis")?;
    println!("Connected to Redis.\n");

    // --- Phase 2: Configuration wizard ---
    let config = run_config_wizard().await?;

    // --- Phase 3: Create notification in DB ---
    let user_id =
        MacroUserIdStr::try_from_email("sandbox-user@test.com").context("invalid user ID")?;
    let notification_id = uuid::Uuid::new_v4();

    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::Channel.with_entity_str("sandbox-entity-id"),
        notification: SandboxNotification {
            message: "Sandbox test notification".to_string(),
        },
        sender_id: None,
        recipient_ids: HashSet::from([user_id.copied()]),
    };

    let notification_repo = DbNotificationRepository::new(db.clone());
    let rows = notification_repo
        .create_notification(request, notification_id, "notification_sandbox", None)
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))?
        .context("notification already exists (duplicate ID)")?;

    let notif_row = rows
        .into_iter()
        .next()
        .context("no user notification rows created")?;

    println!("\nCreated notification {notification_id} for user \"{user_id}\" in DB.\n");

    // --- Phase 4: Run StateMachineA ---
    println!("--- StateMachineA: Ingress Decision ---\n");

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

    let decision_a = state_machine_a
        .ingest(notif_row)
        .await
        .map_err(|e| anyhow::anyhow!("StateMachineA failed: {e}"))?;

    let push_enabled = match &decision_a {
        StateMachineDecisionA::DontSend(_) => {
            println!("\n-> Decision: DontSend (no email will be sent)\n");
            None
        }
        StateMachineDecisionA::BatchWasQueued(_) => {
            println!("\n-> Decision: BatchWasQueued (notification added to digest batch)\n");
            None
        }
        StateMachineDecisionA::Indeterminate(batch) => {
            println!(
                "\n-> Decision: Indeterminate (push will be attempted, deferred to StateMachineB)\n"
            );
            Some(batch.clone().into_inner())
        }
        StateMachineDecisionA::SendImmediate(_) => {
            println!("\n-> Decision: SendImmediate (single email will be sent now)\n");
            None
        }
    };

    // --- Phase 5: Run StateMachineB (only if Indeterminate) ---
    let mut recorded_message_ids: Vec<String> = Vec::new();

    if let Some(push_enabled) = push_enabled {
        println!("--- StateMachineB: Egress Push Attempt ---\n");

        let state_machine_b = StateMachineDriverB {
            message_receipt_repo: DbMessageReceiptRepository::new(db.clone()),
            digest_batcher: RedisDigestBatcher::new(redis_conn.clone()),
            digest_window: config.digest_window,
        };

        let send_checkers = build_send_checkers(&config);

        let request = ResumeMachineBRequest {
            notification_enabled: push_enabled,
            send_notifs: send_checkers,
        };

        let (results, batch_decision) = state_machine_b.continue_machine(request).await;

        println!("\nPer-endpoint results:");
        for (i, result) in results.iter().enumerate() {
            match result {
                Ok(msg_id) => {
                    println!("  endpoint-{}: SUCCESS (message_id: {msg_id})", i + 1);
                    recorded_message_ids.push(msg_id.clone());
                }
                Err(e) => {
                    println!("  endpoint-{}: FAILED ({e})", i + 1);
                }
            }
        }

        match &batch_decision {
            Either::Left(_) => {
                println!("\n-> Decision: DontSend (at least one push succeeded, no email)\n");
            }
            Either::Right(Ok(_)) => {
                println!("\n-> Decision: BatchWasQueued (all pushes failed, added to digest)\n");
            }
            Either::Right(Err(e)) => {
                println!("\n-> Decision: BatchWasQueued attempted but batcher failed: {e}\n");
            }
        }
    }

    // --- Phase 6: Run StateMachineC (only if message IDs were recorded) ---
    if !recorded_message_ids.is_empty() {
        println!("--- StateMachineC: SNS Failure Reconciliation ---\n");
        println!(
            "Recorded {} message ID(s) in DB. Simulating async SNS failures.\n",
            recorded_message_ids.len()
        );

        let state_machine_c = StateMachineDriverC {
            message_receipt_repo: DbMessageReceiptRepository::new(db.clone()),
            digest_batcher: RedisDigestBatcher::new(redis_conn.clone()),
            notif_repo: DbNotificationRepository::new(db.clone()),
            digest_window: config.digest_window,
        };

        for msg_id in &recorded_message_ids {
            let simulate = inquire::Confirm::new(&format!(
                "Simulate SNS delivery failure for message \"{msg_id}\"?"
            ))
            .with_default(true)
            .prompt()
            .context("prompt failed")?;

            if simulate {
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
            } else {
                println!("  -> Skipped (message remains as succeeded)");
            }
        }
        println!();
    }

    // --- Phase 7: Summary ---
    println!("--- Summary ---\n");

    let summary_batcher = RedisDigestBatcher::new(redis_conn);
    match summary_batcher.claim_ready_digest().await {
        Ok(ClaimResult::Ready(batch)) => {
            println!(
                "Digest ready for user \"{}\": {} notification(s) batched",
                batch.user_id,
                batch.notifications.len()
            );
        }
        Ok(ClaimResult::Wait(duration)) => {
            println!(
                "Digest pending (not ready yet, will be ready in {} seconds)",
                duration.as_secs()
            );
        }
        Ok(ClaimResult::Empty) => {
            println!("No digests pending.");
        }
        Err(e) => {
            println!("Error checking digest status: {e}");
        }
    }

    println!("\nSandbox complete.");
    Ok(())
}

async fn run_config_wizard() -> anyhow::Result<SandboxConfig> {
    let digest_minutes: u64 = inquire::CustomType::new("Digest window (minutes)?")
        .with_default(30)
        .prompt()
        .context("prompt failed")?;

    let online_minutes: u64 = inquire::CustomType::new("Online duration threshold (minutes)?")
        .with_default(5)
        .prompt()
        .context("prompt failed")?;

    let is_blocked = inquire::Confirm::new("Is this notification type blocked from email?")
        .with_default(false)
        .prompt()
        .context("prompt failed")?;

    let is_invite = inquire::Confirm::new("Is this notification type an invite?")
        .with_default(false)
        .prompt()
        .context("prompt failed")?;

    let sns_options = vec!["Mock (interactive)", "Real (AWS)"];
    let sns_choice = inquire::Select::new("SNS mode?", sns_options)
        .prompt()
        .context("prompt failed")?;

    let sns_mode = if sns_choice == "Real (AWS)" {
        let endpoint_arn = inquire::Text::new("SNS endpoint ARN?")
            .prompt()
            .context("prompt failed")?;
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
        .prompt()
        .context("prompt failed")?;

    Ok(SandboxConfig {
        digest_window: Duration::from_secs(digest_minutes * 60),
        online_threshold: Duration::from_secs(online_minutes * 60),
        is_blocked,
        is_invite,
        sns_mode,
        num_endpoints,
    })
}

/// Build the appropriate send checkers based on SNS mode.
fn build_send_checkers(config: &SandboxConfig) -> Vec<PushAttempt> {
    match &config.sns_mode {
        SnsMode::Mock => (1..=config.num_endpoints)
            .map(|i| {
                PushAttempt::Mock(interactive::push_attempt::InteractivePushAttempt {
                    endpoint_name: format!("endpoint-{i}"),
                })
            })
            .collect(),
        SnsMode::Real {
            sns_client,
            endpoint_arn,
        } => (1..=config.num_endpoints)
            .map(|i| {
                let arn = if config.num_endpoints == 1 {
                    endpoint_arn.clone()
                } else {
                    inquire::Text::new(&format!("Endpoint ARN for endpoint-{i}?"))
                        .with_default(endpoint_arn)
                        .prompt()
                        .expect("prompt failed")
                };
                PushAttempt::Real(interactive::real_push_attempt::RealSnsPushAttempt {
                    sns_client: sns_client.clone(),
                    endpoint_arn: arn,
                })
            })
            .collect(),
    }
}
