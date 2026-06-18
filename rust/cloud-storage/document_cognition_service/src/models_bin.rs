#![recursion_limit = "256"]
#![allow(unused)]

mod api;
mod config;
mod core;
mod model;
mod service;

pub use config::Config;

use crate::core::model::CHAT_MODELS;
use agent::AgentModel;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelSchema {
    pub name: String,
    pub provider: &'static str,
    pub metadata: ModelMetadata,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelMetadata {
    pub context_window: u64,
}

#[derive(Serialize)]
struct ModelsResponse {
    pub models: Vec<ModelSchema>,
}

impl From<AgentModel> for ModelSchema {
    fn from(m: AgentModel) -> Self {
        Self {
            name: m.api_id().to_owned(),
            provider: m.provider().as_str(),
            metadata: ModelMetadata {
                context_window: m.context_window(),
            },
        }
    }
}

fn main() {
    let models = CHAT_MODELS
        .iter()
        .map(|m| ModelSchema::from(*m))
        .collect::<Vec<_>>();
    let data = ModelsResponse { models };
    println!("{}", serde_json::to_string_pretty(&data).unwrap());
}
