/// Domain models: per-topic event traits, [`Event`](models::Event), [`MacroEvent`](models::MacroEvent), and error types.
pub mod models;

/// Port traits: the inbound and outbound boundaries of the broker.
pub mod ports;

/// Service orchestration for producing and consuming typed events.
pub mod service;
