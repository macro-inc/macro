use super::*;
use crate::{Activity, EntityType};
use std::sync::Mutex;

struct Store {
    fail: bool,
    order: Arc<Mutex<Vec<&'static str>>>,
}
impl ActivityRepo for Store {
    type Err = std::io::Error;
    async fn insert_activities(&self, _: &[Activity]) -> Result<(), Self::Err> {
        if self.fail {
            return Err(std::io::Error::other("failed insert"));
        }
        self.order.lock().unwrap().push("stored");
        Ok(())
    }
    async fn purge_entities(&self, _: &[(EntityType, String)]) -> Result<(), Self::Err> {
        Ok(())
    }
}
struct Observer(Arc<Mutex<Vec<&'static str>>>);
impl ActivityObserver for Observer {
    fn persisted<'a>(
        &'a self,
        _: &'a [Activity],
    ) -> std::pin::Pin<Box<dyn Future<Output = ()> + Send + 'a>> {
        Box::pin(async {
            self.0.lock().unwrap().push("notified");
        })
    }
}

#[tokio::test]
async fn notifications_follow_storage_and_failed_inserts_never_notify() {
    for fail in [false, true] {
        let order = Arc::new(Mutex::new(Vec::new()));
        let service = ActivityMaterializer::new(Store {
            fail,
            order: order.clone(),
        })
        .with_observer(Observer(order.clone()));
        assert_eq!(service.apply(Ingest::Insert(vec![])).await.is_err(), fail);
        assert_eq!(
            *order.lock().unwrap(),
            if fail {
                vec![]
            } else {
                vec!["stored", "notified"]
            }
        );
    }
}
