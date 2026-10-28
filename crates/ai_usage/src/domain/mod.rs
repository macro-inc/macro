//! Domain layer: the cost model, ports, and the service that computes cost.

pub mod counting;
pub mod financial;
pub mod financial_service;
pub mod ports;
pub mod service;
pub mod tracking;

pub use counting::{AiUsageEnforcement, NON_BILLABLE_AI_FEATURES, is_billable_feature};
pub use ports::{
    AiFeature, CompletionUsage, FeatureUsage, FinancialFuture, FinancialRateResolver,
    FinancialUsage, InvocationFunding, ModelPricing, NoOpUsageRecorder, Price, Result,
    SYSTEM_USER_ID, Usage, UsageAmount, UsageApiParams, UsageContext, UsageError, UsageEvent,
    UsageRecorder, UsageRepo, UsageService, UsageSummary, normalize_model_id,
};
pub use service::UsageServiceImpl;
