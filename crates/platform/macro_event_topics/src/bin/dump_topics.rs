//! Prints all Kafka topic names defined in `macro_event_topics` as a JSON array.

fn main() {
    println!(
        "{}",
        serde_json::to_string(&macro_event_topics::all_topic_names())
            .expect("serializing topic names cannot fail")
    );
}
