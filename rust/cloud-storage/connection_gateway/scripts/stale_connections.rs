//! This entrypoint is used to periodically clean up stale connections from the db
use aws_sdk_dynamodb::types::AttributeValue;
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

const DEFAULT_TIMEOUT_THRESHOLD: u64 = 60_000; // 60 seconds in milliseconds

#[derive(Debug, Clone)]
#[allow(dead_code, unused)]
struct ConnectionInfo {
    pk: String,
    sk: String,
    entity_type: String,
    entity_id: String,
    connection_id: String,
    user_id: String,
    created_at: u64,
    last_ping: Option<u64>,
    is_stale: bool,
    staleness_duration_ms: u64,
}

impl ConnectionInfo {
    fn from_item(item: &HashMap<String, AttributeValue>) -> Option<Self> {
        let pk = item.get("PK")?.as_s().ok()?.clone();
        let sk = item.get("SK")?.as_s().ok()?.clone();

        let entity_type = item
            .get("entity_type")
            .and_then(|v| v.as_s().ok())
            .cloned()
            .unwrap_or_else(|| "unknown".to_string());

        let entity_id = item
            .get("entity_id")
            .and_then(|v| v.as_s().ok())
            .cloned()
            .unwrap_or_else(|| "unknown".to_string());

        let connection_id = item
            .get("connection_id")
            .and_then(|v| v.as_s().ok())
            .cloned()
            .unwrap_or_else(|| sk.clone()); // Use SK as fallback

        let user_id = item
            .get("user_id")
            .and_then(|v| v.as_s().ok())
            .cloned()
            .unwrap_or_else(|| "unknown".to_string());

        let created_at = item
            .get("created_at")
            .and_then(|v| v.as_n().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0); // Default to epoch if not present

        let last_ping = item
            .get("last_ping")
            .and_then(|v| v.as_n().ok())
            .and_then(|v| v.parse::<u64>().ok());

        let current_timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let (is_stale, staleness_duration_ms) = match last_ping {
            Some(ping) => {
                let age = current_timestamp.saturating_sub(ping);
                (age > DEFAULT_TIMEOUT_THRESHOLD, age)
            }
            None => {
                let age = current_timestamp.saturating_sub(created_at);
                (age > DEFAULT_TIMEOUT_THRESHOLD, age)
            }
        };

        Some(ConnectionInfo {
            pk,
            sk,
            entity_type,
            entity_id,
            connection_id,
            user_id,
            created_at,
            last_ping,
            is_stale,
            staleness_duration_ms,
        })
    }

    #[allow(dead_code)]
    fn last_activity_timestamp(&self) -> u64 {
        self.last_ping.unwrap_or(self.created_at)
    }

    #[allow(dead_code)]
    fn last_activity_datetime(&self) -> String {
        let timestamp = self.last_activity_timestamp();
        let datetime = DateTime::<Utc>::from_timestamp_millis(timestamp as i64)
            .unwrap_or_else(|| DateTime::<Utc>::from_timestamp_millis(0).unwrap());
        datetime.format("%Y-%m-%d %H:%M:%S UTC").to_string()
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize AWS config
    let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .load()
        .await;
    let client = aws_sdk_dynamodb::Client::new(&config);

    // Get table name from environment variable or command line argument
    let table_name = std::env::args()
        .nth(1)
        .or_else(|| std::env::var("CONNECTION_GATEWAY_TABLE").ok())
        .expect("Please provide table name as argument or set CONNECTION_GATEWAY_TABLE env var");

    let delete_mode = std::env::var("DELETE_STALE").is_ok();

    println!("Scanning table: {}", table_name);
    println!(
        "Timeout threshold: {} seconds",
        DEFAULT_TIMEOUT_THRESHOLD / 1000
    );
    println!(
        "Current time: {}",
        Utc::now().format("%Y-%m-%d %H:%M:%S UTC")
    );
    println!("Including connections with missing entity_type/entity_id fields");
    if delete_mode {
        println!("DELETE MODE ENABLED - Will delete stale connections after confirmation");
    }
    println!("\n{}", "=".repeat(80));

    let mut total_connections = 0;
    let mut stale_connections = 0;
    let mut stale_by_entity_type: HashMap<String, usize> = HashMap::new();
    let mut all_stale_connections: Vec<ConnectionInfo> = Vec::new();

    // Scan the entire table
    let mut exclusive_start_key = None;

    loop {
        let mut scan_builder = client.scan().table_name(&table_name);

        if let Some(key) = exclusive_start_key {
            scan_builder = scan_builder.set_exclusive_start_key(Some(key));
        }

        let result = scan_builder.send().await?;

        if let Some(items) = result.items {
            for item in items {
                if let Some(conn_info) = ConnectionInfo::from_item(&item) {
                    total_connections += 1;

                    if conn_info.is_stale {
                        stale_connections += 1;
                        *stale_by_entity_type
                            .entry(conn_info.entity_type.clone())
                            .or_insert(0) += 1;
                        all_stale_connections.push(conn_info);
                    }
                }
            }
        }

        exclusive_start_key = result.last_evaluated_key;
        if exclusive_start_key.is_none() {
            break;
        }
    }

    // Print summary statistics
    println!("\n SUMMARY STATISTICS");
    println!("{}", "-".repeat(80));
    println!("Total connections: {}", total_connections);
    println!(
        "Stale connections: {} ({:.1}%)",
        stale_connections,
        if total_connections > 0 {
            (stale_connections as f64 / total_connections as f64) * 100.0
        } else {
            0.0
        }
    );

    println!("\n📈 STALE CONNECTIONS BY ENTITY TYPE");
    println!("{}", "-".repeat(80));
    let mut entity_types: Vec<_> = stale_by_entity_type.iter().collect();
    entity_types.sort_by(|a, b| b.1.cmp(a.1));
    for (entity_type, count) in entity_types {
        println!("{:<20} {:>10} connections", entity_type, count);
    }

    // Delete option
    if delete_mode && stale_connections > 0 {
        println!(
            "\n⚠️  WARNING: About to delete {} stale connections",
            stale_connections
        );
        println!("Type 'yes' to confirm deletion: ");

        use std::io::{self, BufRead};
        let stdin = io::stdin();
        let mut line = String::new();
        stdin.lock().read_line(&mut line)?;

        if line.trim() == "yes" {
            println!("\n🗑️  Deleting stale connections...");
            let mut deleted = 0;
            let mut failed = 0;

            for conn in all_stale_connections {
                let pk = conn.pk.clone();
                let sk = conn.sk.clone();
                match client
                    .delete_item()
                    .table_name(&table_name)
                    .key("PK", AttributeValue::S(conn.pk))
                    .key("SK", AttributeValue::S(conn.sk))
                    .send()
                    .await
                {
                    Ok(_) => deleted += 1,
                    Err(e) => {
                        eprintln!("Failed to delete {}/{}: {}", pk, sk, e);
                        failed += 1;
                    }
                }

                // Progress indicator every 100 deletions
                if deleted % 100 == 0 {
                    print!(".");
                    use std::io::Write;
                    io::stdout().flush()?;
                }
            }

            println!("\n✅ Deleted {} connections", deleted);
            if failed > 0 {
                println!("Failed to delete {} connections", failed);
            }
        } else {
            println!("Deletion cancelled");
        }
    }

    println!("\n💡 Usage options:");
    println!("  - Export to CSV: EXPORT_CSV=1 cargo run --bin list_stale_connections <table_name>");
    println!(
        "  - Delete stale connections: DELETE_STALE=1 cargo run --bin list_stale_connections <table_name>"
    );

    Ok(())
}
