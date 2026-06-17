//! Domain layer for AI projections.

/// Domain models for AI projections.
pub mod models;
/// Port traits for repositories, generators, and services.
pub mod ports;
/// Service orchestration for materialization.
pub mod service;

pub use models::{
    AiProjectionCacheKey, CompleteProjectionRequest, DEFAULT_TOOLSET_VERSION,
    FailProjectionRequest, GenerateProjectionRequest, GeneratedProjection,
    MaterializeProjectionRequest, MaterializeProjectionResponse, ProjectionError, ProjectionExpiry,
    ProjectionInstance, ProjectionStatus, RefreshCadence, Result, ScheduleGenerationReason,
    ScheduleProjectionRequest, Target, UpsertProjectionInstanceRequest, prompt_hash,
};
pub use ports::{AiProjectionRepository, AiProjectionService, ProjectionGenerator};
pub use service::AiProjectionServiceImpl;
