//! This crate is not used in prodection code, this is a local development utility that is able
//! to poll a locally running instance of dynamodb and then forward the events to a lambda handler
//! that is also running locally.
//!
//! You should not need to run this crate directly, instead update the justfiles that expect this behaviour
//! see the lambda_aggregate_frecency justfile for an example
use aws_sdk_dynamodbstreams::types::{AttributeValue, Record, ShardIteratorType};
use chrono::Utc;
use macro_env_var::env_var;
use serde_json::json;
use std::collections::HashMap;
use std::time::Duration;
use tokio::time::sleep;

env_var!(
    struct Config {
        LambdaEndpoint,
        TableName,
        PollIntervalSeconds
    }
);

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let Config {
        lambda_endpoint,
        table_name,
        poll_interval_seconds,
    } = Config::unwrap_new();

    let poll_interval = Duration::from_secs(
        poll_interval_seconds
            .as_ref()
            .parse()
            .expect("poll interval seconds was not an integer"),
    );

    println!("Starting local DynamoDB stream processor...");
    println!("Make sure:");
    println!("1. DynamoDB is running on port 8000");
    println!("2. 'cargo lambda watch' is running on port 9000");
    println!("3. The 'frecency' table exists with streams enabled");
    println!();

    // Configure AWS SDK for local DynamoDB
    let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .region(aws_config::Region::new("us-east-1"))
        .load()
        .await;

    let dynamodb_client = aws_sdk_dynamodb::Client::new(&config);
    let streams_client = aws_sdk_dynamodbstreams::Client::new(&config);

    // Get stream ARN
    let stream_arn = get_stream_arn(&dynamodb_client, &table_name).await?;
    println!("Monitoring stream: {}", stream_arn);

    // Get shards
    let stream_desc = streams_client
        .describe_stream()
        .stream_arn(&stream_arn)
        .send()
        .await?;

    let shards = stream_desc
        .stream_description()
        .map(|d| d.shards())
        .ok_or("No shards found")?;

    if shards.is_empty() {
        return Err("No shards found in stream".into());
    }

    // Initialize shard iterators
    let mut shard_iterators: HashMap<String, Option<String>> = HashMap::new();

    for shard in shards {
        let shard_id = shard.shard_id().ok_or("No shard ID")?.to_string();

        let iterator_response = streams_client
            .get_shard_iterator()
            .stream_arn(&stream_arn)
            .shard_id(&shard_id)
            .shard_iterator_type(ShardIteratorType::Latest)
            .send()
            .await?;

        let iterator = iterator_response.shard_iterator().map(String::from);
        shard_iterators.insert(shard_id.clone(), iterator);
        println!("Monitoring shard: {}", shard_id);
    }

    println!("Waiting for DynamoDB stream events...");

    let http_client = reqwest::Client::new();

    // Main polling loop
    loop {
        for (shard_id, iterator_opt) in shard_iterators.iter_mut() {
            if let Some(iterator) = iterator_opt {
                match streams_client
                    .get_records()
                    .shard_iterator(iterator.clone())
                    .send()
                    .await
                {
                    Ok(response) => {
                        // Process any records
                        let records = response.records();
                        if !records.is_empty() {
                            println!(
                                "\n[{}] Found {} new records in shard {}",
                                Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ"),
                                records.len(),
                                shard_id
                            );

                            if let Err(e) = process_stream_records(
                                records,
                                &http_client,
                                &table_name,
                                &lambda_endpoint,
                            )
                            .await
                            {
                                eprintln!("Error processing records: {}", e);
                            }
                        }

                        // Update iterator for next poll
                        *iterator_opt = response.next_shard_iterator().map(String::from);
                    }
                    Err(e) => {
                        eprintln!("Error polling shard {}: {}", shard_id, e);
                        // Try to get a new iterator
                        match streams_client
                            .get_shard_iterator()
                            .stream_arn(&stream_arn)
                            .shard_id(shard_id)
                            .shard_iterator_type(ShardIteratorType::Latest)
                            .send()
                            .await
                        {
                            Ok(resp) => {
                                *iterator_opt = resp.shard_iterator().map(String::from);
                            }
                            Err(_) => {
                                *iterator_opt = None;
                            }
                        }
                    }
                }
            }
        }

        sleep(poll_interval).await;
    }
}

async fn get_stream_arn(
    client: &aws_sdk_dynamodb::Client,
    table_name: &TableName,
) -> Result<String, Box<dyn std::error::Error>> {
    let response = client
        .describe_table()
        .table_name(table_name.as_ref())
        .send()
        .await?;

    response
        .table()
        .and_then(|t| t.latest_stream_arn())
        .map(String::from)
        .ok_or_else(|| {
            format!(
                "Table {} does not have streams enabled",
                table_name.as_ref()
            )
            .into()
        })
}

async fn process_stream_records(
    records: &[Record],
    http_client: &reqwest::Client,
    table_name: &TableName,
    lambda_endpoint: &LambdaEndpoint,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut lambda_records = Vec::new();

    for record in records {
        // Convert DynamoDB stream record to Lambda event format
        let lambda_record = json!({
            "eventID": record.event_id().unwrap_or(""),
            "eventName": record.event_name().map(|e| e.as_str()).unwrap_or(""),
            "eventVersion": "1.1",
            "eventSource": "aws:dynamodb",
            "awsRegion": "us-east-1",
            "dynamodb": {
                "Keys": convert_stream_attributes(record.dynamodb().and_then(|d| d.keys())),
                "NewImage": convert_stream_attributes(record.dynamodb().and_then(|d| d.new_image())),
                "OldImage": convert_stream_attributes(record.dynamodb().and_then(|d| d.old_image())),
                "SequenceNumber": record.dynamodb().and_then(|d| d.sequence_number()).unwrap_or(""),
                "SizeBytes": record.dynamodb().and_then(|d| d.size_bytes()).unwrap_or(0),
                "StreamViewType": record.dynamodb()
                    .and_then(|d| d.stream_view_type())
                    .map(|t| t.as_str())
                    .unwrap_or(""),
            },
            "eventSourceARN": record.event_source().unwrap_or(""),
            "tableName": table_name.as_ref(),
        });

        lambda_records.push(lambda_record);
    }

    let lambda_event = json!({
        "Records": lambda_records
    });

    println!("Invoking Lambda with {} records", lambda_records.len());

    match http_client
        .post(lambda_endpoint.as_ref())
        .json(&lambda_event)
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                let text = response.text().await?;
                println!("Lambda invocation successful: {}", text);
            } else {
                eprintln!(
                    "Lambda invocation failed: {} - {}",
                    response.status(),
                    response.text().await?
                );
            }
        }
        Err(e) => {
            if e.is_connect() {
                eprintln!(
                    "Could not connect to Lambda. Make sure 'cargo lambda watch' is running on port 9000"
                );
            } else {
                eprintln!("Error invoking Lambda: {}", e);
            }
        }
    }

    Ok(())
}

fn convert_stream_attributes(attrs: Option<&HashMap<String, AttributeValue>>) -> serde_json::Value {
    match attrs {
        Some(map) => {
            let mut json_map = serde_json::Map::new();
            for (key, value) in map {
                json_map.insert(key.clone(), stream_attribute_value_to_json(value));
            }
            serde_json::Value::Object(json_map)
        }
        None => serde_json::Value::Null,
    }
}

fn stream_attribute_value_to_json(attr: &AttributeValue) -> serde_json::Value {
    match attr {
        AttributeValue::S(s) => json!({ "S": s }),
        AttributeValue::N(n) => json!({ "N": n }),
        AttributeValue::B(b) => json!({ "B": base64::encode(b.as_ref()) }),
        AttributeValue::Ss(ss) => json!({ "SS": ss }),
        AttributeValue::Ns(ns) => json!({ "NS": ns }),
        AttributeValue::Bs(bs) => {
            json!({ "BS": bs.iter().map(|b| base64::encode(b.as_ref())).collect::<Vec<_>>() })
        }
        AttributeValue::M(m) => {
            let mut map = serde_json::Map::new();
            for (k, v) in m {
                map.insert(k.clone(), stream_attribute_value_to_json(v));
            }
            json!({ "M": serde_json::Value::Object(map) })
        }
        AttributeValue::L(l) => {
            let list: Vec<_> = l.iter().map(stream_attribute_value_to_json).collect();
            json!({ "L": list })
        }
        AttributeValue::Null(_) => json!({ "NULL": true }),
        AttributeValue::Bool(b) => json!({ "BOOL": b }),
        _ => serde_json::Value::Null,
    }
}

// Base64 encoding helper
mod base64 {
    pub fn encode(input: &[u8]) -> String {
        use std::fmt::Write;
        let mut result = String::new();
        for byte in input {
            write!(&mut result, "{:02x}", byte).unwrap();
        }
        result
    }
}
