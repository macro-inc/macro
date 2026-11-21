//! What the forwarder refuses when it enforces, and what it only records
//! when it doesn't. Each decision is recorded on the request's span
//! (`would_refuse`); under `Egress::Proxied` the request is forwarded either
//! way, so the rollout can show which programs a refusal would break before
//! any does.

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
    /// A scoped or dry run calling a route anyone may call that reaches
    /// someone else or fetches an outside URL: no signed scope holds it,
    /// since it takes no credential.
    AnonymousOutward,
}

impl Refusal {
    /// Its name on the span.
    pub(crate) fn as_str(self) -> &'static str {
        self.into()
    }

    /// What the program is told, so the model can do something else.
    pub(crate) fn message(self, method: &str, path: &str) -> String {
        match self {
            Self::OutsideService | Self::UnknownOperation => format!(
                "{method} {path} isn't an operation of Macro's SDK, so this run can't send it. Use the macro SDK's methods instead of building requests by hand; DescribeCodeTools and ReadCodeDocs list them."
            ),
            Self::DryRunWrite => "A dry run doesn't send changes. Return what the program would change instead of changing it.".to_owned(),
            Self::UnparseableUrl => format!(
                "{method} {path} isn't a URL this run can send. Call the macro SDK instead of building the URL by hand."
            ),
            Self::NoCredential => format!(
                "{method} {path} was sent without the run's credential, so this run can't send it. Call the macro SDK, which adds it."
            ),
            Self::AnonymousOutward => format!(
                "{method} {path} reaches someone else or an outside site without a credential, which this run may not do. Leave it out, or say what it would do in the result for a person to act on."
            ),
        }
    }
}

/// Routes anyone may call that reach someone else (public booking) or fetch
/// an outside URL (unfurl, its proxy and bulk unfurl, the read-receipt pixel),
/// or write into someone's database (its webhook),
/// as `(service, method, path)` under the service's base. A scoped or dry
/// run is refused them: they take no credential, so no signed scope holds
/// them.
const ANONYMOUS_OUTWARD: &[(&str, &str, &str)] = &[
    (
        "calendar",
        "POST",
        "/scheduling/public/{profile}/{event}/book",
    ),
    (
        "calendar",
        "POST",
        "/scheduling/public/bookings/{id}/cancel",
    ),
    (
        "calendar",
        "POST",
        "/scheduling/public/bookings/{id}/reschedule",
    ),
    ("unfurl", "GET", "/unfurl"),
    ("unfurl", "GET", "/proxy"),
    ("unfurl", "POST", "/bulk"),
    ("unfurl", "POST", "/unfurl/bulk"),
    ("email", "GET", "/opens/{token}"),
    // A database's webhook: a secret URL anyone holding it may post rows to.
    ("storage", "POST", "/databases/webhooks/{token}"),
];

/// What a run's forwarder holds its requests to.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct RunPolicy {
    /// Refuse what it would refuse, instead of only recording it.
    pub(crate) enforce: bool,
    /// The run is a dry run: it may not write.
    pub(crate) dry_run: bool,
    /// The run's credential is held to a narrower scope.
    pub(crate) scoped: bool,
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
    policy: RunPolicy,
    credentialed: bool,
) -> Decision {
    let dry_run = policy.dry_run;
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
    let read_method = if method == "HEAD" { "GET" } else { method };
    if (policy.scoped || policy.dry_run)
        && ANONYMOUS_OUTWARD
            .iter()
            .any(|(listed, listed_method, template)| {
                *listed == service
                    && *listed_method == read_method
                    && path_segments(template)
                        .zip(path_segments(relative))
                        .is_some_and(|(template, segments)| fits(&template, &segments))
            })
    {
        return refused(Refusal::AnonymousOutward);
    }
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
    policy: RunPolicy,
    credentialed: bool,
) -> Decision {
    let decisions: Vec<Decision> = services
        .iter()
        .map(|service| decide(catalog, service, base, method, path, policy, credentialed))
        .collect();
    decisions
        .iter()
        .find(|decision| decision.refusal == Some(Refusal::AnonymousOutward))
        .or_else(|| {
            decisions
                .iter()
                .find(|decision| decision.operation.is_some())
        })
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
