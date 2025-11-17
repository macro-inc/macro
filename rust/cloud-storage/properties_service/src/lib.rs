//! Properties Service library following hexagonal architecture pattern
//!
//! This library provides property management domain logic and can be composed
//! into various runtime contexts (services, workers, lambdas, etc.)

pub mod domain;
pub mod inbound;
pub mod outbound;
