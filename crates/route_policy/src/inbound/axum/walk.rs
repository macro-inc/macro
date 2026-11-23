//! A test helper for a service: which of its routes declare no category.

use axum::{Router, body::Body, extract::Request, http::Method};
use tower::ServiceExt;

use crate::{Caller, ResolvedCaller, RouteDecision};

/// Marks a request as a probe of the route policy: the layer answers with its
/// decision and does not call the handler.
#[derive(Clone, Copy, Debug)]
pub(super) struct Probe;

/// The routes in `routes` (method and path) that answer without a
/// [`RouteDecision`], so they declare no category: a route built with
/// `axum::routing` instead of this module's constructors, or a handler added
/// with `MethodRouter`'s own methods. Each is requested as a person, marked
/// as a probe: a route that declares a category answers with its decision and
/// does not run its handler. A route that declares none has no layer to stop
/// it, so its handler does run: build `router` with test state that has
/// nothing behind it.
///
/// Take `routes` from the service's OpenAPI document and its `route_service`
/// and `nest_service` mounts, so a route added later fails the test that
/// calls this until it declares a category.
pub async fn undeclared_routes(router: Router, routes: &[(Method, &str)]) -> Vec<String> {
    let mut undeclared = Vec::new();
    for (method, path) in routes {
        let described = format!("{method} {path}");
        let Ok(mut request) = Request::builder()
            .method(method)
            .uri(*path)
            .body(Body::empty())
        else {
            undeclared.push(described);
            continue;
        };
        request
            .extensions_mut()
            .insert(ResolvedCaller(Caller::Person));
        request.extensions_mut().insert(Probe);
        match router.clone().oneshot(request).await {
            Ok(response) if response.extensions().get::<RouteDecision>().is_some() => {}
            Ok(_) | Err(_) => undeclared.push(described),
        }
    }
    undeclared
}
