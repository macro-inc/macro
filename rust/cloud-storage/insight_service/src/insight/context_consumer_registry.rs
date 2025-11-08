use super::consumer::ChatInsightContextConsumer;
use super::consumer::InsightContextConsumer;
use std::sync::Arc;

// register consumers here
pub fn create_consumers() -> Vec<Arc<dyn InsightContextConsumer>> {
    let chat_consumer: ChatInsightContextConsumer = ChatInsightContextConsumer;
    vec![Arc::new(chat_consumer)]
}
