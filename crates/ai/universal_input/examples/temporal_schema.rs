//! Export exact production contracts for synthetic model evaluation.
use universal_input::{domain::InputIntent, outbound::temporal::AgentTemporalExtractor};
fn main() {
    let schema = AgentTemporalExtractor::schema();
    let output = serde_json::json!({ "calendar": { "schema": schema, "system": AgentTemporalExtractor::prompt(InputIntent::Calendar, &schema) }, "task": { "schema": schema, "system": AgentTemporalExtractor::prompt(InputIntent::Task, &schema) } });
    println!(
        "{}",
        serde_json::to_string_pretty(&output).expect("JSON schema is serializable")
    );
}
