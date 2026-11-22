//! Route constructors that declare each handler's [`Category`], and the layer
//! they put on it.
//!
//! Use these instead of `axum::routing::{get, post, ...}`. Chain methods with
//! `merge`, never with `MethodRouter`'s own `.get`/`.post`, which add a
//! handler with no category:
//!
//! ```
//! use axum::Router;
//! use route_policy::{Category, inbound::axum::{get, post}};
//!
//! async fn read() {}
//! async fn write() {}
//!
//! let router: Router = Router::new()
//!     .route("/items/{id}", get(Category::Read, read).merge(post(Category::Write, write)));
//! ```
//!
//! The layer wraps the handler, not a path, so the category goes wherever the
//! router is nested or versioned. It runs after routing and before the
//! handler's extractors, and decides from the [`ResolvedCaller`] the service
//! put in the request's extensions. An enforced refusal is answered 403. The
//! [`RouteDecision`] goes in the request's extensions for the authorization
//! extractors, and in the response's, with the request span's fields.

mod walk;

#[cfg(test)]
mod test;

use std::{
    convert::Infallible,
    future::Future,
    pin::Pin,
    task::{Context, Poll},
};

pub use walk::undeclared_routes;

use axum::{
    Json,
    extract::{MatchedPath, Request},
    handler::Handler,
    http::{Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{MethodFilter, MethodRouter},
};
use macro_tower_layers::ResponseSpanFields;
use tower::{Layer, Service};

use crate::{
    ActiveRollout, Caller, Category, DecisionSlot, NO_CALLER_MESSAGE, NoRollout, Refusal,
    RefusalCode, ResolvedCaller, RouteDecision, Verdict,
};

macro_rules! method_constructor {
    ($(#[$doc:meta])* $name:ident, $filter:expr) => {
        $(#[$doc])*
        pub fn $name<H, T, S>(category: Category, handler: H) -> MethodRouter<S>
        where
            H: Handler<T, S>,
            T: 'static,
            S: Clone + Send + Sync + 'static,
        {
            on($filter, category, handler)
        }
    };
}

method_constructor!(
    /// A `GET` route of `category`. It answers `HEAD` too.
    get,
    MethodFilter::GET
);
method_constructor!(
    /// A `POST` route of `category`.
    post,
    MethodFilter::POST
);
method_constructor!(
    /// A `PUT` route of `category`.
    put,
    MethodFilter::PUT
);
method_constructor!(
    /// A `PATCH` route of `category`.
    patch,
    MethodFilter::PATCH
);
method_constructor!(
    /// A `DELETE` route of `category`.
    delete,
    MethodFilter::DELETE
);

/// A route of `category` for the methods in `filter`.
pub fn on<H, T, S>(filter: MethodFilter, category: Category, handler: H) -> MethodRouter<S>
where
    H: Handler<T, S>,
    T: 'static,
    S: Clone + Send + Sync + 'static,
{
    axum::routing::on(filter, handler.layer(RoutePolicyLayer::new(category)))
}

/// A route of `category` for every method.
pub fn any<H, T, S>(category: Category, handler: H) -> MethodRouter<S>
where
    H: Handler<T, S>,
    T: 'static,
    S: Clone + Send + Sync + 'static,
{
    axum::routing::any(handler.layer(RoutePolicyLayer::new(category)))
}

/// The layer the constructors put on each handler. Wrap a service with it
/// directly where a route takes a service rather than a handler
/// (`route_service`, `nest_service`).
#[derive(Clone, Copy, Debug)]
pub struct RoutePolicyLayer {
    category: Category,
}

impl RoutePolicyLayer {
    /// The layer for a route of `category`.
    pub fn new(category: Category) -> Self {
        Self { category }
    }
}

impl<Inner> Layer<Inner> for RoutePolicyLayer {
    type Service = RoutePolicyService<Inner>;

    fn layer(&self, inner: Inner) -> Self::Service {
        RoutePolicyService {
            inner,
            category: self.category,
        }
    }
}

/// A route's service behind its policy.
#[derive(Clone, Debug)]
pub struct RoutePolicyService<Inner> {
    inner: Inner,
    category: Category,
}

impl<Inner> Service<Request> for RoutePolicyService<Inner>
where
    Inner: Service<Request, Response = Response, Error = Infallible>,
    Inner::Future: Send + 'static,
{
    type Response = Response;
    type Error = Infallible;
    type Future = Pin<Box<dyn Future<Output = Result<Response, Infallible>> + Send>>;

    fn poll_ready(&mut self, context: &mut Context<'_>) -> Poll<Result<(), Infallible>> {
        self.inner.poll_ready(context)
    }

    fn call(&mut self, mut request: Request) -> Self::Future {
        let caller = request
            .extensions()
            .get::<ResolvedCaller>()
            .map(|ResolvedCaller(caller)| *caller);
        let safe_method = matches!(
            *request.method(),
            Method::GET | Method::HEAD | Method::OPTIONS
        );
        let preflight = *request.method() == Method::OPTIONS;
        let decision = match request.extensions().get::<ActiveRollout>() {
            Some(ActiveRollout(rollout)) => RouteDecision::new(
                caller,
                self.category,
                safe_method,
                preflight,
                rollout.as_ref(),
            ),
            None => RouteDecision::new(caller, self.category, safe_method, preflight, &NoRollout),
        };
        if decision.verdict == Verdict::Unresolved {
            tracing::warn!(
                route_policy.category = %self.category,
                route_policy.code = %RefusalCode::NoCaller,
                http.route = request.extensions().get::<MatchedPath>().map(MatchedPath::as_str),
                "route policy refused a request with no caller"
            );
            return Box::pin(std::future::ready(Ok(with_decision(
                no_caller_response(self.category),
                decision,
            ))));
        }
        if let Verdict::Refused(refusal) = decision.verdict {
            tracing::warn!(
                route_policy.category = %refusal.category,
                route_policy.caller = %refusal.caller,
                route_policy.code = %refusal.code,
                http.route = request.extensions().get::<MatchedPath>().map(MatchedPath::as_str),
                "route policy refused a request"
            );
            return Box::pin(std::future::ready(Ok(with_decision(
                refusal.into_response(),
                decision,
            ))));
        }
        if request.extensions().get::<walk::Probe>().is_some() {
            return Box::pin(std::future::ready(Ok(with_decision(
                Response::new(axum::body::Body::empty()),
                decision,
            ))));
        }
        request.extensions_mut().insert(decision);
        let slot = DecisionSlot::new(decision);
        request.extensions_mut().insert(slot.clone());
        let handling = self.inner.call(request);
        // An extractor may decide again; the response describes its decision.
        Box::pin(async move { Ok(with_decision(handling.await?, slot.get())) })
    }
}

/// `response` with `decision` in its extensions, and as the request span's
/// fields.
fn with_decision(mut response: Response, decision: RouteDecision) -> Response {
    let mut fields = vec![
        ("route_policy.category", <&str>::from(decision.category)),
        ("route_policy.outcome", decision.verdict.name()),
    ];
    if let Some(caller) = decision.verdict.caller() {
        fields.push(("route_policy.caller", caller.into()));
    }
    match decision.verdict {
        Verdict::Refused(refusal) | Verdict::Observed(refusal) => {
            fields.push(("route_policy.code", refusal.code.into()));
        }
        Verdict::Unresolved => fields.push(("route_policy.code", RefusalCode::NoCaller.into())),
        Verdict::Allowed(_) | Verdict::Public => {}
    }
    response.extensions_mut().insert(decision);
    response.extensions_mut().insert(ResponseSpanFields(fields));
    response
}

/// The answer to a request the route policy refused.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct RefusalBody {
    /// What the caller is told: who must do it instead.
    message: String,
    /// The rule that refused.
    code: RefusalCode,
    /// The route's category.
    category: Category,
    /// Who was refused.
    caller: Caller,
}

/// The answer to a request on a route that needs a caller, when Macro
/// couldn't tell who sent it.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct NoCallerBody {
    /// What the caller is told.
    message: &'static str,
    /// Always [`RefusalCode::NoCaller`].
    code: RefusalCode,
    /// The route's category.
    category: Category,
}

fn no_caller_response(category: Category) -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(NoCallerBody {
            message: NO_CALLER_MESSAGE,
            code: RefusalCode::NoCaller,
            category,
        }),
    )
        .into_response()
}

impl IntoResponse for Refusal {
    fn into_response(self) -> Response {
        (
            StatusCode::FORBIDDEN,
            Json(RefusalBody {
                message: self.message(),
                code: self.code,
                category: self.category,
                caller: self.caller,
            }),
        )
            .into_response()
    }
}
