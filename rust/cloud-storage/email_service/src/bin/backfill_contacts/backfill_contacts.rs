mod config;
mod process;

use anyhow::Context;
use macro_entrypoint::MacroEntrypoint;
use sqlx::postgres::PgPoolOptions;
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    println!("Loading configuration...");
    MacroEntrypoint::default().init();
    let config = config::Config::from_env().context("Failed to load configuration")?;

    println!("Connecting to the database...");
    let db_pool = PgPoolOptions::new()
        .min_connections(5)
        .max_connections(60)
        .connect(&config.database_url)
        .await
        .context("Could not connect to db")?;

    let macro_ids: Vec<String> = config
        .macro_ids
        .split(',')
        .map(|id| id.trim().to_string())
        .collect();

    let aws_config = macro_aws_config::get_macro_aws_config().await;

    let contacts_ingress = contacts::domain::service::SqsContactsIngress {
        queue: contacts::outbound::ingress::SqsContactsQueue::new(
            aws_sdk_sqs::Client::new(&aws_config),
            config.contacts_queue.clone(),
        ),
    };

    println!("Processing {} macro IDs: {:?}", macro_ids.len(), macro_ids);

    for (index, macro_id) in macro_ids.iter().enumerate() {
        println!(
            "\n=== Processing macro ID {} ({}/{}) ===",
            macro_id,
            index + 1,
            macro_ids.len()
        );

        match process::process_macro_id(&db_pool, &contacts_ingress, macro_id).await {
            Ok(()) => {
                println!("Completed processing for {}.", macro_id);
            }
            Err(e) => {
                panic!("Failed to process macro ID {}: {:?}", macro_id, e);
            }
        }
    }

    println!("\n=== All macro IDs processed ===");
    Ok(())
}
