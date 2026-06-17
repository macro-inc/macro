//! Domain layer: the cost model, ports, and the service that computes cost.

pub mod ports;
pub mod service;

pub use ports::{
    AiFeature, CompletionUsage, FeatureUsage, Price, Result, SYSTEM_USER_ID, Usage, UsageApiParams,
    UsageContext, UsageError, UsageEvent, UsageRecorder, UsageRepo, UsageService, UsageSummary,
};
pub use service::UsageServiceImpl;
