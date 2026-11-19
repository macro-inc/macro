//! What the forwarder will refuse once it enforces. For now each decision is
//! only recorded on the request's span (`would_refuse`): the request is
//! forwarded either way, so the rollout can show which programs a refusal
//! would break before any does.

use std::collections::HashMap;

#[cfg(test)]
mod test;

/// Why a request would be refused, by its name on the span.
#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub(crate) enum Refusal {
    /// Its path leaves the service's base, through `..` or the like, to
    /// another service on the same host.
    OutsideService,
    /// No SDK operation of the service has its method and path.
    UnknownOperation,
    /// A write during a dry run.
    DryRunWrite,
    /// Its URL doesn't parse, so nothing about it can be checked.
    UnparseableUrl,
    /// It carries no credential: it reaches a route anyone may call, which
    /// no scope signed into the run's credential can hold.
    NoCredential,
}

impl Refusal {
    /// Its name on the span.
    pub(crate) fn as_str(self) -> &'static str {
        self.into()
    }
}

/// What the forwarder decided about one request.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Decision {
    /// The SDK operation it is, when one matches.
    pub(crate) operation: Option<&'static str>,
    /// Why it would be refused, if it would.
    pub(crate) refusal: Option<Refusal>,
    /// The service has no operations in the SDK catalog (static files, the
    /// connection gateway, document content), so its paths aren't checked.
    pub(crate) uncatalogued: bool,
}

/// The SDK's operations by service, as method and path template.
pub(crate) struct Catalog {
    routes: HashMap<&'static str, Vec<Route>>,
}

struct Route {
    key: &'static str,
    method: &'static str,
    segments: Vec<&'static str>,
    write: bool,
}

impl Catalog {
    /// The catalog of the SDK this build runs.
    pub(crate) fn of_the_sdk() -> Self {
        Self::from_operations(crate::domain::operations().iter().map(|(key, operation)| {
            (
                key.as_str(),
                operation.method.as_str(),
                operation.path.as_str(),
                operation.write,
            )
        }))
    }

    /// A catalog of `(key, method, path, write)`, keys named `service.operation`.
    pub(crate) fn from_operations(
        operations: impl IntoIterator<Item = (&'static str, &'static str, &'static str, bool)>,
    ) -> Self {
        let mut routes: HashMap<&'static str, Vec<Route>> = HashMap::new();
        for (key, method, path, write) in operations {
            let Some((service, _)) = key.split_once('.') else {
                continue;
            };
            routes.entry(service).or_default().push(Route {
                key,
                method,
                segments: path_segments(path).unwrap_or_default(),
                write,
            });
        }
        Self { routes }
    }

    /// The route `method` and `path` are, preferring a literal segment to a
    /// `{…}` one where both fit, as the services' routers do.
    fn find(&self, service: &str, method: &str, path: &str) -> Option<&Route> {
        // A HEAD is the GET it asks about.
        let method = if method == "HEAD" { "GET" } else { method };
        let segments = path_segments(path)?;
        self.routes
            .get(service)?
            .iter()
            .filter(|route| route.method == method && fits(&route.segments, &segments))
            .min_by_key(|route| {
                route
                    .segments
                    .iter()
                    .map(|segment| is_parameter(segment))
                    .collect::<Vec<_>>()
            })
    }
}

/// A path's segments, read exactly: `/a//b/` is `["a", "", "b", ""]`, as a
/// router reads it. None for a path that doesn't start with `/`.
fn path_segments(path: &str) -> Option<Vec<&str>> {
    Some(path.strip_prefix('/')?.split('/').collect())
}

fn is_parameter(segment: &str) -> bool {
    segment.starts_with('{') && segment.ends_with('}')
}

/// Whether `segments` are the template's, a `{…}` segment standing for any
/// one non-empty segment.
fn fits(template: &[&str], segments: &[&str]) -> bool {
    template.len() == segments.len()
        && template.iter().zip(segments).all(|(wanted, segment)| {
            (is_parameter(wanted) && !segment.is_empty()) || wanted == segment
        })
}

/// What a request to `service` would meet: `base` is the service's base
/// path, `path` the request's path once the URL is normalized.
pub(crate) fn decide(
    catalog: &Catalog,
    service: &str,
    base: &str,
    method: &str,
    path: &str,
    dry_run: bool,
    credentialed: bool,
) -> Decision {
    let refused = |refusal| Decision {
        operation: None,
        refusal: Some(refusal),
        uncatalogued: false,
    };
    let base = base.trim_end_matches('/');
    let Some(relative) = path
        .strip_prefix(base)
        .filter(|rest| rest.is_empty() || rest.starts_with('/'))
    else {
        return refused(Refusal::OutsideService);
    };
    if !catalog.routes.contains_key(service) {
        // Unchecked paths, and no credential asked for: these hosts serve
        // some files without one. A dry run still sends only reads.
        let writes = !matches!(method, "GET" | "HEAD");
        return Decision {
            operation: None,
            refusal: (dry_run && writes).then_some(Refusal::DryRunWrite),
            uncatalogued: true,
        };
    }
    let Some(route) = catalog.find(service, method, relative) else {
        return refused(Refusal::UnknownOperation);
    };
    let refusal = if dry_run && route.write {
        Some(Refusal::DryRunWrite)
    } else if !credentialed {
        Some(Refusal::NoCredential)
    } else {
        None
    };
    Decision {
        operation: Some(route.key),
        refusal,
        uncatalogued: false,
    }
}

/// What a request to a base `services` share would meet: services reached
/// under one base (storage, search and properties under the document
/// service's) take each other's requests, so it is whichever names the
/// operation; else unchecked only when none of them has a catalog; else the
/// first refusal.
pub(crate) fn decide_across(
    catalog: &Catalog,
    services: &[&str],
    base: &str,
    method: &str,
    path: &str,
    dry_run: bool,
    credentialed: bool,
) -> Decision {
    let decisions: Vec<Decision> = services
        .iter()
        .map(|service| decide(catalog, service, base, method, path, dry_run, credentialed))
        .collect();
    decisions
        .iter()
        .find(|decision| decision.operation.is_some())
        .or_else(|| {
            decisions
                .iter()
                .find(|decision| !decision.uncatalogued)
                .or_else(|| decisions.first())
        })
        .copied()
        .unwrap_or(Decision {
            operation: None,
            refusal: Some(Refusal::UnknownOperation),
            uncatalogued: false,
        })
}
