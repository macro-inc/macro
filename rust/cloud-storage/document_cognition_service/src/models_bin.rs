#![recursion_limit = "256"]
#![allow(unused)]

mod api;
mod config;
mod core;
mod model;
mod service;

pub use config::Config;

use crate::core::model::CHAT_MODELS;
use crate::model::response::models::{AIModel, GetModelsResponse};
use ai::types::ModelWithMetadataAndProvider;

fn main() {
    let models = CHAT_MODELS
        .iter()
        .map(|m| AIModel {
            name: m.to_string(),
            provider: m.provider(),
            metadata: m.metadata(),
        })
        .collect::<Vec<AIModel>>();
    let data = GetModelsResponse { models };
    println!("{}", serde_json::to_string_pretty(&data).unwrap());
}
