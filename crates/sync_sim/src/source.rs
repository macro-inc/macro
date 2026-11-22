//! Complete Rust reproductions with literal configuration and script inputs.
use crate::*;
use std::fmt::Write;

mod steps;

impl Outcome {
    /// Render a complete standalone Rust test, retaining every policy override and step.
    /// The name is sanitized to an identifier; the script contains no ambient inputs.
    pub fn story_source(&self, name: &str) -> String {
        let name = name
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
            .collect::<String>();
        let mut out = format!(
            "use sync_sim::*;\n\n// SIM_SEED={}\n#[test]\nfn regression_{}() {{\n    let mut config = SimConfig::calm({});\n",
            self.seed, name, self.seed
        );
        for (field, value) in [
            ("fields", self.config.fields.to_string()),
            ("documents", self.config.documents.to_string()),
            ("per_step", self.config.per_step.to_string()),
            ("ties", format!("TieMode::{:?}", self.config.ties)),
            ("net", format!("{:?}", self.config.net)),
            ("storage", format!("{:?}", self.config.storage)),
            ("budgets", format!("{:?}", self.config.budgets)),
            (
                "server_storage_latency",
                format!("{:?}", self.config.server_storage_latency),
            ),
        ] {
            writeln!(out, "    config.{field} = {value};").expect("String write");
        }
        for client in &self.config.faulty_editor_clients {
            writeln!(
                out,
                "    config.faulty_editor_clients.insert(ClientName({:?}.into()));",
                client.0
            )
            .expect("String write");
        }
        for doc in &self.config.surfaces {
            writeln!(out, "    config.surfaces.insert(DocIx({}));", doc.0).expect("String write");
        }
        for (doc, seed) in &self.config.seeds {
            writeln!(
                out,
                "    config.seeds.insert(DocIx({}), {});",
                doc.0,
                seed_source(seed)
            )
            .expect("String write");
        }
        let session = &self.config.session;
        for (field, value) in [
            (
                "transport",
                format!("TransportKind::{:?}", session.transport),
            ),
            ("timeouts", policy(&session.timeouts)),
            ("heartbeat", policy(&session.heartbeat)),
            ("backoff", policy(&session.backoff)),
            ("converge", policy(&session.converge)),
            ("wal", policy(&session.wal)),
            ("reset_budget", policy(&session.reset_budget)),
            (
                "snapshot_interval",
                format!("{:?}", session.snapshot_interval)
                    .replace("Millis(", "doc_sync_core::Millis("),
            ),
            ("presence_timeout", policy(&session.presence_timeout)),
            (
                "presence_refresh",
                format!("{:?}", session.presence_refresh)
                    .replace("Millis(", "doc_sync_core::Millis("),
            ),
        ] {
            writeln!(out, "    config.session.{field} = {value};").expect("String write");
        }
        out.push_str("    let outcome = Sim::new(config).run(&[\n");
        for step in &self.script {
            writeln!(out, "        {},", steps::source(step)).expect("String write");
        }
        out.push_str("    ]);\n    if let Err(failures) = invariants::check_all(&outcome) { panic!(\"{failures:#?}\"); }\n    outcome.check_replay().unwrap();\n}\n");
        out
    }
    /// Shrink diagnostics: complete source plus the last50 actual events.
    pub fn failure_report(&self) -> String {
        format!(
            "{}\nlast events:\n{:#?}",
            self.story_source("regression"),
            self.events
                .iter()
                .skip(self.events.len().saturating_sub(50))
                .collect::<Vec<_>>()
        )
    }
}
fn policy(value: &impl std::fmt::Debug) -> String {
    let value = format!("{value:?}")
        .replace("Millis(", "doc_sync_core::Millis(")
        .replace("WallDuration(", "doc_sync_core::WallDuration(");
    if value.starts_with("doc_sync_core::") {
        value
    } else {
        format!("doc_sync_core::{value}")
    }
}
fn seed_source(seed: &SeedDocument) -> String {
    match seed {
        SeedDocument::Editor(state) => format!("SeedDocument::Editor(serde_json::json!({state}))"),
        SeedDocument::StoredEditor(state) => format!(
            "SeedDocument::StoredEditor(serde_json::from_str({:?}).expect(\"stored editor JSON\"))",
            state.to_string()
        ),
        SeedDocument::Empty => "SeedDocument::Empty".into(),
        SeedDocument::Form(fields) => format!("SeedDocument::Form(vec!{fields:?})"),
        SeedDocument::Cached { server, s3, local } => format!(
            "SeedDocument::Cached {{ server: vec!{server:?}, s3: {}, local: {} }}",
            s3.as_ref()
                .map(|(fields, after)| format!("Some((vec!{fields:?}, Millis({})))", after.0))
                .unwrap_or("None".into()),
            local
                .as_ref()
                .map(|fields| format!("Some(vec!{fields:?})"))
                .unwrap_or("None".into())
        ),
    }
}
