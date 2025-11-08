use std::sync::atomic::{AtomicUsize, Ordering};

use ai::types::Model;
use metering_db_client::{
    CreateUsageRecordRequest, CreateUsageRecordRequestBuilder, OperationType, ServiceName,
};

static COUNTER: AtomicUsize = AtomicUsize::new(0);
pub fn create_test_usage_request() -> CreateUsageRecordRequest {
    let user_num = COUNTER.fetch_add(1, Ordering::Relaxed);
    CreateUsageRecordRequestBuilder::default()
        .user_id(format!("user_{user_num}"))
        .service_name(ServiceName::DocumentCognitionService)
        .operation_type(OperationType::Chat)
        .input_tokens(100)
        .output_tokens(50)
        .model(Model::OpenAiGpt41)
        .used_open_router(true)
        .usage(serde_json::json!({"hello": 66}))
        .build()
        .unwrap()
}
