//! Append-only JSON IPC for the GenericSurface TypeScript peer. IDs remain strings.
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PeerCommand {
    Open {
        client: String,
        peer: String,
        document: String,
        ai: bool,
        readonly: bool,
    },
    Frame {
        client: String,
        bytes: Vec<u8>,
    },
    Tick {
        now: u32,
    },
    Edit {
        client: String,
        field: u16,
        value: u16,
    },
    Move {
        client: String,
        from: u16,
        to: u16,
    },
    Chatter {
        client: String,
        awareness: bool,
        bytes: Vec<u8>,
    },
    Crash {
        client: String,
    },
    InstallRows {
        document: String,
        rows: Vec<PeerWalRow>,
    },
    Finals,
    Shutdown,
    Text {
        client: String,
        text: String,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct PeerWalRow {
    pub id: u32,
    pub update: Vec<u8>,
    pub delivered: bool,
    pub created_at: String,
    pub owner: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PeerEffect {
    Frame {
        client: String,
        bytes: Vec<u8>,
    },
    Chatter {
        client: String,
        awareness: bool,
        bytes: Vec<u8>,
    },
    Closed {
        client: String,
    },
    Text {
        client: String,
        text: String,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct PeerFinal {
    pub client: String,
    pub initialized: bool,
    pub vv: BTreeMap<String, i32>,
    pub value_json: String,
    pub rows: Vec<PeerWalRow>,
}
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct PeerReport {
    pub version: u16,
    pub loro_version: String,
    pub now: u32,
    pub wake_at: Option<u32>,
    pub effects: Vec<PeerEffect>,
    pub peers: Vec<PeerFinal>,
}

pub fn typescript() -> String {
    let types = specta::Types::default()
        .register::<PeerCommand>()
        .register::<PeerReport>();
    let generated = specta_typescript::Typescript::default()
        .export(&types, specta_serde::PhasesFormat)
        .expect("peer protocol types export");
    format!(
        "{}\n",
        generated
            .lines()
            .map(str::trim_end)
            .collect::<Vec<_>>()
            .join("\n")
    )
}
