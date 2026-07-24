//! Dump the `agent-runtime.v0` message schemas as one JSON object mapping
//! type name → JSON Schema. Consumers (e.g. the TypeScript runtime) generate
//! their wire types from this output so they cannot drift from this crate.
//!
//! Run with:
//!
//! ```text
//! cargo run -p agent_runtime_protocol --example dump_schema
//! ```

use agent_runtime_protocol::schema::v0::{AcpMessage, Command, CommandResult, SystemEvent};

fn main() {
    let schemas = serde_json::json!({
        "SystemEvent": schemars::schema_for!(SystemEvent),
        "Command": schemars::schema_for!(Command),
        "CommandResult": schemars::schema_for!(CommandResult),
        "AcpMessage": schemars::schema_for!(AcpMessage),
    });
    println!("{}", serde_json::to_string_pretty(&schemas).expect("schemas serialize"));
}
