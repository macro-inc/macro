mod api;
mod config;
mod context;
mod insight;
mod serve;
mod service;

use clap::Parser;
use config::Config;
use macro_entrypoint::MacroEntrypoint;

#[derive(Parser)]
#[command(name = "insight_service")]
#[command(about = "Insight service for generating and managing user insights")]
struct Args {
    #[arg(long, help = "Run as a batch job instead of starting the server")]
    batch_job: bool,
}

#[tokio::main]
async fn main() {
    let args = Args::parse();

    MacroEntrypoint::default().init();

    let config = Config::from_env().unwrap();

    if args.batch_job {
        tracing::info!("Starting insight batch processing job");

        // Run batch processing instead of server
        use context::ServiceContext;
        use insight::batch_processor::InsightBatchProcessor;
        use std::sync::Arc;

        let service_context = Arc::new(
            ServiceContext::try_from_config(&config)
                .await
                .expect("To be valid context"),
        );
        let processor = InsightBatchProcessor::new(service_context.macro_db.clone());

        let batch_size = std::env::var("BATCH_SIZE")
            .unwrap_or("500".to_string())
            .parse::<i64>()
            .unwrap_or(500);

        match processor.process_all_users(batch_size).await {
            Ok(stats) => {
                tracing::info!(
                    "Batch processing completed successfully. Processed: {}, Failed: {}, Expired cleaned: {}",
                    stats.users_processed,
                    stats.users_failed,
                    stats.expired_cleaned
                );
                std::process::exit(0);
            }
            Err(e) => {
                tracing::error!("Batch processing failed: {:?}", e);
                std::process::exit(1);
            }
        }
    } else {
        tracing::info!("insight generation service started");

        tracing::info!("Context queue started, polling for messages");
        let config_clone = config.clone();
        tokio::spawn(insight::setup_and_poll(config_clone));
        serve::setup_and_serve(config).await
    }
}
