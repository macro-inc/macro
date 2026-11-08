//! Tells an inbox's readers its Focus changed, through the connection gateway.
//!
//! A burst of mail in one inbox becomes few pushes. The first goes out at once;
//! what follows collapses into one per [`NOTIFY_WINDOW`]. The last push of a
//! burst is always a repeat one window later, because readers read Focus from a
//! replica that can lag the write they were told about.

use std::{
    collections::HashMap,
    future::Future,
    sync::{Arc, Mutex, MutexGuard, PoisonError},
    time::Duration,
};

use connection_gateway_client::ConnectionGatewayClient;
use email::domain::focus::FocusNotifier;
use email_types::api::refresh::RefreshEmailEvent;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use tracing::{Instrument as _, field::Empty};
use tracing_opentelemetry::OpenTelemetrySpanExt as _;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// The shortest gap between two pushes about one inbox.
const NOTIFY_WINDOW: Duration = Duration::from_secs(3);

/// Sends one push about an inbox.
pub trait FocusDelivery: Send + Sync + 'static {
    /// Tell everyone reading `link_id` to read Focus again. Failures are logged.
    fn deliver(
        &self,
        owner: &MacroUserIdStr<'static>,
        link_id: Uuid,
    ) -> impl Future<Output = ()> + Send;
}

/// Classifications stored since an inbox's last push.
#[derive(Default)]
struct OpenWindow {
    /// The trace of the newest one, which the next push joins.
    newest: Option<opentelemetry::Context>,
    count: i64,
}

type OpenWindows = Arc<Mutex<HashMap<Uuid, OpenWindow>>>;

fn locked(windows: &OpenWindows) -> MutexGuard<'_, HashMap<Uuid, OpenWindow>> {
    windows.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The [`FocusNotifier`] the worker runs, with one window per inbox.
pub struct CoalescingNotifier<D> {
    delivery: Arc<D>,
    windows: OpenWindows,
    tracker: TaskTracker,
    shutdown: CancellationToken,
}

impl<D: FocusDelivery> CoalescingNotifier<D> {
    /// Push through `delivery`, with each inbox's pushes on `tracker`, until `shutdown`.
    pub fn new(delivery: D, tracker: TaskTracker, shutdown: CancellationToken) -> Self {
        Self {
            delivery: Arc::new(delivery),
            windows: Arc::default(),
            tracker,
            shutdown,
        }
    }
}

impl<D: FocusDelivery> FocusNotifier for CoalescingNotifier<D> {
    fn focus_changed(&self, owner: &MacroUserIdStr<'static>, link_id: Uuid) {
        let classification = tracing::Span::current().context();
        {
            let mut windows = locked(&self.windows);
            if let Some(window) = windows.get_mut(&link_id) {
                window.newest = Some(classification);
                window.count += 1;
                return;
            }
            windows.insert(link_id, OpenWindow::default());
        }
        self.tracker.spawn(run_window(
            Arc::clone(&self.delivery),
            Arc::clone(&self.windows),
            self.shutdown.clone(),
            owner.clone(),
            link_id,
            classification,
        ));
    }
}

/// Push for one inbox until a window passes with nothing new to say.
async fn run_window<D: FocusDelivery>(
    delivery: Arc<D>,
    windows: OpenWindows,
    shutdown: CancellationToken,
    owner: MacroUserIdStr<'static>,
    link_id: Uuid,
    classification: opentelemetry::Context,
) {
    let mut parent = classification;
    let mut coalesced = 1;
    loop {
        let span = tracing::info_span!(
            "email_focus.notify",
            %link_id,
            coalesced,
            delivered = Empty,
            otel.status_code = Empty,
            otel.status_description = Empty,
        );
        // Starts a trace when there's nothing to join, not under this task's.
        let _ = span.set_parent(parent.clone());
        let push = delivery.deliver(&owner, link_id).instrument(span);
        if shutdown.run_until_cancelled(push).await.is_none() {
            return;
        }

        let window = tokio::time::sleep(NOTIFY_WINDOW);
        if shutdown.run_until_cancelled(window).await.is_none() {
            return;
        }
        let mut open = locked(&windows);
        let Some(window) = open.get_mut(&link_id) else {
            return;
        };
        if let Some(newest) = window.newest.take() {
            parent = newest;
            coalesced = std::mem::take(&mut window.count);
            continue;
        }
        // Nothing new since the last push. If that one was for a new
        // classification, repeat it for the replica; if it was the repeat, stop.
        if coalesced == 0 {
            open.remove(&link_id);
            return;
        }
        coalesced = 0;
    }
}

/// Pushes `refresh_email` to an inbox's owner and the people it's delegated to.
pub struct GatewayDelivery {
    gateway: ConnectionGatewayClient,
    db: PgPool,
}

impl GatewayDelivery {
    /// Push through `gateway`, reading delegates from `db`.
    pub fn new(gateway: ConnectionGatewayClient, db: PgPool) -> Self {
        Self { gateway, db }
    }
}

/// The current span's W3C context, for the client's read to join: the gateway
/// keeps a message's own trace context off the websocket.
fn traceparent() -> Option<String> {
    let mut carrier = HashMap::new();
    opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.inject_context(&tracing::Span::current().context(), &mut carrier);
    });
    carrier.remove("traceparent")
}

impl FocusDelivery for GatewayDelivery {
    async fn deliver(&self, owner: &MacroUserIdStr<'static>, link_id: Uuid) {
        let span = tracing::Span::current();
        let mut readers = vec![owner.as_ref().to_owned()];
        match sqlx::query_scalar!(
            "SELECT primary_macro_id FROM macro_user_links WHERE link_id = $1",
            link_id,
        )
        .fetch_all(&self.db)
        .await
        {
            Ok(delegates) => readers.extend(delegates),
            Err(error) => {
                tracing::warn!(error = ?error, %link_id, "focus notification delegates unavailable");
            }
        }
        readers.sort_unstable();
        readers.dedup();

        let event = RefreshEmailEvent::FocusUpdated {
            link_id,
            traceparent: traceparent(),
        };
        let payload = match serde_json::to_value(&event) {
            Ok(payload) => payload,
            Err(error) => {
                tracing::error!(error = ?error, %link_id, "focus notification unserializable");
                kafka_util::record_span_error(&span, "focus notification unserializable");
                return;
            }
        };
        match self
            .gateway
            .refresh_email_for_users(&readers, payload)
            .await
        {
            Ok(receipts) => {
                let delivered = receipts
                    .iter()
                    .map(|receipt| receipt.delivery_count)
                    .sum::<u64>();
                span.record("delivered", i64::try_from(delivered).unwrap_or(i64::MAX));
            }
            Err(error) => {
                tracing::warn!(error = ?error, %link_id, "focus notification failed");
                kafka_util::record_span_error(&span, "focus notification failed");
            }
        }
    }
}
