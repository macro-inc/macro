use super::consumer::InsightContextConsumer;
use super::context_consumer_registry::create_consumers;
use model::insight_context::ProvidedContext;
use std::collections::HashMap;
use std::iter::IntoIterator;
use std::sync::Arc;

pub struct ContextRouter {
    consumers: HashMap<String, Arc<dyn InsightContextConsumer>>,
}

impl ContextRouter {
    pub fn default() -> Self {
        let consumers = create_consumers();
        Self::new(consumers)
    }

    pub fn new<T>(consumers: T) -> Self
    where
        T: IntoIterator<Item = Arc<dyn InsightContextConsumer>>,
    {
        let consumers = consumers
            .into_iter()
            .map(|consumer| (consumer.source_name(), consumer))
            .collect::<HashMap<_, _>>();
        Self { consumers }
    }

    pub fn route_context(
        &self,
        context: &ProvidedContext,
    ) -> Option<Arc<dyn InsightContextConsumer>> {
        self.consumers.get(&context.provider_source).map(Arc::clone)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::context::ServiceContext;
    use crate::insight::consumer::InsightContextConsumer;
    use model::insight_context::UserInsightRecord;
    use std::sync::Arc;
    struct MockConsumerChat;
    struct MockConsumerGoblin;

    #[async_trait::async_trait]
    impl InsightContextConsumer for MockConsumerChat {
        fn source_name(&self) -> String {
            "chat".to_string()
        }
        fn trigger_generation_at_n_messages(&self) -> usize {
            unimplemented!()
        }
        async fn generate_insights(
            &self,
            _: &[String],
            _: &str,
            _: &[UserInsightRecord],
            _: Arc<ServiceContext>,
        ) -> Result<Vec<UserInsightRecord>, anyhow::Error> {
            unimplemented!()
        }
    }

    #[async_trait::async_trait]
    impl InsightContextConsumer for MockConsumerGoblin {
        fn source_name(&self) -> String {
            "goblin".to_string()
        }
        fn trigger_generation_at_n_messages(&self) -> usize {
            unimplemented!()
        }
        async fn generate_insights(
            &self,
            _: &[String],
            _: &str,
            _: &[UserInsightRecord],
            _: Arc<ServiceContext>,
        ) -> Result<Vec<UserInsightRecord>, anyhow::Error> {
            unimplemented!()
        }
    }
    fn make_consumers() -> Vec<Arc<dyn InsightContextConsumer>> {
        vec![Arc::new(MockConsumerChat), Arc::new(MockConsumerGoblin)]
    }

    #[test]
    fn test_routing() -> Result<(), ()> {
        let router = ContextRouter::new(make_consumers());
        let chat_context = ProvidedContext {
            provider_source: "chat".to_string(),
            resource_id: "swag".to_string(),
            user_id: "nunya".to_string(),
        };
        let consumer = router.route_context(&chat_context);
        assert!(consumer.is_some(), "some consumer");
        assert_eq!(
            consumer.expect("what the freak").source_name().as_str(),
            "chat"
        );
        let dne = ProvidedContext {
            provider_source: "dne".to_string(),
            resource_id: "swag".to_string(),
            user_id: "nunya".to_string(),
        };
        assert!(router.route_context(&dne).is_none(), "no dne");
        let gob = ProvidedContext {
            provider_source: "goblin".to_string(),
            resource_id: "swag".to_string(),
            user_id: "nunya".to_string(),
        };
        assert!(router.route_context(&gob).is_some(), "yes gob");
        Ok(())
    }
}
