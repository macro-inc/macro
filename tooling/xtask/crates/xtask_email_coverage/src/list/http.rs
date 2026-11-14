//! `http` rows: every route of an axum router, found by evaluating the
//! function that builds it.
//!
//! The walker follows what a router expression is made of: `Router::new()`,
//! `.route(path, methods)`, `.nest(prefix, router)`, `.merge(router)`, calls of
//! functions that return routers (in this crate or another), `let` bindings
//! and router parameters. Anything else that could add a route is an error.

use std::collections::BTreeSet;

use rootcause::prelude::*;
use syn::spanned::Spanned;
use syn::visit::Visit;
use syn::{Expr, ExprCall, ExprLit, ExprMethodCall, FnArg, Item, ItemFn, Lit, Pat, Stmt, Type};

use super::Entry;
use crate::repo::{Loc, Module, Repo};
use crate::sources::HttpSource;

#[cfg(test)]
mod test;

/// Method-router constructors and chained methods, with the HTTP method each
/// one serves.
const METHODS: [(&str, &str); 8] = [
    ("get", "GET"),
    ("post", "POST"),
    ("put", "PUT"),
    ("patch", "PATCH"),
    ("delete", "DELETE"),
    ("head", "HEAD"),
    ("options", "OPTIONS"),
    ("any", "ANY"),
];

/// Router and method-router methods that add no route.
const NOT_ROUTING: [&str; 5] = ["layer", "route_layer", "with_state", "clone", "fallback"];

/// Router methods that add routes.
const ROUTING: [&str; 3] = ["route", "nest", "merge"];

#[derive(Clone, Debug)]
struct Route {
    method: &'static str,
    path: String,
    loc: Loc,
}

/// A name a router expression may refer to.
enum Binding<'a> {
    /// A router parameter, evaluated at the call.
    Routes(Vec<Route>),
    /// A `let`, evaluated when it is used as a router.
    Init(&'a Expr),
}

/// The function being evaluated: where it is and the names it has bound, in
/// source order.
struct Scope<'a> {
    module: &'a Module,
    file: &'a syn::File,
    bindings: Vec<(String, Binding<'a>)>,
}

struct Walker<'a> {
    repo: &'a Repo,
    source: &'a HttpSource,
    /// Names from `skip` and `mounted_again` that were met.
    met: BTreeSet<String>,
    /// Functions being evaluated, to stop at a cycle.
    evaluating: Vec<(String, String)>,
}

/// Lists the routes the router built by `source.root` serves.
pub(crate) fn list(repo: &Repo, source: &HttpSource) -> Result<Vec<Entry>, Report> {
    let mut walker = Walker {
        repo,
        source,
        met: BTreeSet::new(),
        evaluating: Vec::new(),
    };
    let module = repo.module_of(&source.root.file)?;
    let loc = Loc {
        file: source.root.file.clone(),
        line: 1,
    };
    let routes = walker.function(&module, &source.root.ident, &loc, |_, _| Ok(None))?;

    // A configured function the walk never met means the configuration is stale.
    for name in source.skip.iter().chain(&source.mounted_again) {
        if !walker.met.contains(name) {
            bail!(
                "[http] names `{name}`, which the router built by {}::{} never calls",
                source.root.file,
                source.root.ident
            );
        }
    }

    Ok(routes
        .into_iter()
        .map(|route| Entry {
            key: format!("{} {}", route.method, route.path),
            matcher: String::new(),
            loc: route.loc,
        })
        .collect())
}

impl Walker<'_> {
    /// Evaluates function `name` of `module`. `router_argument` is asked for
    /// the routes of each router parameter, by position.
    fn function(
        &mut self,
        module: &Module,
        name: &str,
        loc: &Loc,
        mut router_argument: impl FnMut(&mut Self, usize) -> Result<Option<Vec<Route>>, Report>,
    ) -> Result<Vec<Route>, Report> {
        let file = self.repo.parse(&module.file)?;
        let function = file
            .items
            .iter()
            .find_map(|item| match item {
                Item::Fn(function) if function.sig.ident == name => Some(function),
                _ => None,
            })
            .ok_or_else(|| report!("{loc}: {} declares no function `{name}`", module.file))?;

        let mut scope = Scope {
            module,
            file: &file,
            bindings: Vec::new(),
        };
        for (position, parameter) in function.sig.inputs.iter().enumerate() {
            let Some(parameter_name) = router_parameter(parameter) else {
                continue;
            };
            let Some(routes) = router_argument(self, position)? else {
                bail!(
                    "{}: `{name}` takes a router, which the walker has nothing to bind to",
                    Loc::new(&module.file, parameter.span())
                );
            };
            scope
                .bindings
                .push((parameter_name, Binding::Routes(routes)));
        }

        let entered = (module.file.clone(), name.to_owned());
        if self.evaluating.contains(&entered) {
            bail!("{loc}: `{name}` builds its router from itself");
        }
        self.evaluating.push(entered);
        let routes = self.body(function, &mut scope);
        self.evaluating.pop();
        routes
    }

    fn body<'a>(
        &mut self,
        function: &'a ItemFn,
        scope: &mut Scope<'a>,
    ) -> Result<Vec<Route>, Report> {
        let file = &scope.module.file;
        let name = &function.sig.ident;
        let Some((tail, statements)) = function.block.stmts.split_last() else {
            bail!("{}: `{name}` is empty", Loc::new(file, function.span()));
        };

        // Only `let` may come before the tail expression. A statement that
        // adds routes some other way (`router = router.route(..)`, an `if`)
        // would be missed, so it is an error.
        for statement in statements {
            if let Stmt::Local(local) = statement
                && let Some(bound) = bound_name(&local.pat)
                && let Some(init) = &local.init
                && init.diverge.is_none()
            {
                scope.bindings.push((bound, Binding::Init(&init.expr)));
                continue;
            }

            // An assignment may add routes inside a function it calls
            // (`router = add_routes(router)`), which no method name shows.
            let assigned = match statement {
                Stmt::Expr(Expr::Assign(assign), _) => Some(assign.span()),
                _ => None,
            };
            let mut routing = RoutingCalls::default();
            routing.visit_stmt(statement);
            if let Some(span) = routing.first.or(assigned) {
                bail!(
                    "{}: `{name}` adds routes in a statement the walker cannot follow; \
                     build the router in `let` bindings and one final expression",
                    Loc::new(file, span)
                );
            }
        }

        let Stmt::Expr(tail, None) = tail else {
            bail!(
                "{}: `{name}` does not end in a router expression",
                Loc::new(file, tail.span())
            );
        };
        self.router(tail, scope, scope.bindings.len())
    }

    /// The routes of a router expression. Only the first `visible` bindings
    /// of `scope` are in scope for it.
    fn router(
        &mut self,
        expr: &Expr,
        scope: &Scope<'_>,
        visible: usize,
    ) -> Result<Vec<Route>, Report> {
        let loc = Loc::new(&scope.module.file, expr.span());
        match expr {
            Expr::Paren(inner) => self.router(&inner.expr, scope, visible),
            Expr::Group(inner) => self.router(&inner.expr, scope, visible),
            Expr::Reference(inner) => self.router(&inner.expr, scope, visible),
            Expr::MethodCall(call) => self.method_call(call, scope, visible),
            Expr::Call(call) => self.call(call, scope, visible),
            Expr::Path(path) => {
                let Some(name) = path.path.get_ident() else {
                    bail!("{loc}: cannot follow this path as a router");
                };
                let binding = scope
                    .bindings
                    .iter()
                    .enumerate()
                    .take(visible)
                    .rev()
                    .find(|(_, (bound, _))| name == bound);
                match binding {
                    Some((_, (_, Binding::Routes(routes)))) => Ok(routes.clone()),
                    Some((position, (_, Binding::Init(init)))) => {
                        self.router(init, scope, position)
                    }
                    None => bail!("{loc}: `{name}` is not a router the walker can follow"),
                }
            }
            _ => bail!("{loc}: cannot follow this expression as a router"),
        }
    }

    fn method_call(
        &mut self,
        call: &ExprMethodCall,
        scope: &Scope<'_>,
        visible: usize,
    ) -> Result<Vec<Route>, Report> {
        let loc = Loc::new(&scope.module.file, call.method.span());
        let method = call.method.to_string();
        let arguments: Vec<&Expr> = call.args.iter().collect();

        if NOT_ROUTING.contains(&method.as_str()) {
            return self.router(&call.receiver, scope, visible);
        }

        let mut routes = self.router(&call.receiver, scope, visible)?;
        match (method.as_str(), arguments.as_slice()) {
            ("route", [path, method_router]) => {
                let path = path_text(path, scope)?;
                for method in methods(method_router, &scope.module.file)? {
                    routes.push(Route {
                        method,
                        path: path.clone(),
                        loc: loc.clone(),
                    });
                }
            }
            ("nest", [prefix, nested]) => {
                let prefix = path_text(prefix, scope)?;
                for mut route in self.router(nested, scope, visible)? {
                    route.path = nested_path(&prefix, &route.path);
                    routes.push(route);
                }
            }
            ("merge", [merged]) => routes.extend(self.router(merged, scope, visible)?),
            _ => bail!("{loc}: the walker does not know the router method `{method}`"),
        }
        Ok(routes)
    }

    fn call(
        &mut self,
        call: &ExprCall,
        scope: &Scope<'_>,
        visible: usize,
    ) -> Result<Vec<Route>, Report> {
        let loc = Loc::new(&scope.module.file, call.span());
        let Expr::Path(function) = &*call.func else {
            bail!("{loc}: cannot follow this call as a router");
        };
        let segments: Vec<String> = function
            .path
            .segments
            .iter()
            .map(|segment| segment.ident.to_string())
            .collect();
        if segments.ends_with(&["Router".to_owned(), "new".to_owned()]) {
            return Ok(Vec::new());
        }

        let (module, name) = self.repo.resolve(scope.module, &segments, &loc)?;
        if self.source.skip.contains(&name) {
            self.met.insert(name);
            return Ok(Vec::new());
        }
        if self.source.mounted_again.contains(&name) {
            let Some(inner) = call.args.first() else {
                bail!("{loc}: `{name}` is listed as mounted_again but takes no router");
            };
            self.met.insert(name);
            return self.router(inner, scope, visible);
        }

        self.function(&module, &name, &loc, |walker, position| {
            call.args
                .iter()
                .nth(position)
                .map(|argument| walker.router(argument, scope, visible))
                .transpose()
        })
    }
}

/// The name of a parameter whose type is `Router` or `Router<..>`.
fn router_parameter(parameter: &FnArg) -> Option<String> {
    let FnArg::Typed(parameter) = parameter else {
        return None;
    };
    let Type::Path(ty) = &*parameter.ty else {
        return None;
    };
    if ty.path.segments.last()?.ident != "Router" {
        return None;
    }
    bound_name(&parameter.pat)
}

/// The name a `let` or parameter pattern binds, when it binds exactly one.
fn bound_name(pattern: &Pat) -> Option<String> {
    match pattern {
        Pat::Ident(ident) => Some(ident.ident.to_string()),
        Pat::Type(typed) => bound_name(&typed.pat),
        _ => None,
    }
}

/// A route path or nest prefix: a string literal, or a `const` of the same
/// file that is one.
fn path_text(expr: &Expr, scope: &Scope<'_>) -> Result<String, Report> {
    let loc = Loc::new(&scope.module.file, expr.span());
    match expr {
        Expr::Lit(ExprLit {
            lit: Lit::Str(text),
            ..
        }) => Ok(text.value()),
        Expr::Path(path) => {
            let Some(name) = path.path.get_ident() else {
                bail!(
                    "{loc}: this route path is neither a string literal nor a const of the same file"
                );
            };
            scope
                .file
                .items
                .iter()
                .find_map(|item| match item {
                    Item::Const(constant) if constant.ident == *name => match &*constant.expr {
                        Expr::Lit(ExprLit {
                            lit: Lit::Str(text),
                            ..
                        }) => Some(text.value()),
                        _ => None,
                    },
                    _ => None,
                })
                .ok_or_else(|| {
                    report!("{loc}: `{name}` is not a string const declared in the same file")
                })
        }
        _ => bail!("{loc}: this route path is neither a string literal nor a const"),
    }
}

/// The HTTP methods of a method-router expression such as
/// `get(a).post(b).layer(c)` or `axum::routing::delete(d)`.
fn methods(expr: &Expr, file: &str) -> Result<Vec<&'static str>, Report> {
    let loc = Loc::new(file, expr.span());
    let method_of = |name: &syn::Ident| {
        METHODS
            .iter()
            .find(|(function, _)| name == function)
            .map(|(_, method)| *method)
    };

    match expr {
        Expr::MethodCall(call) => {
            let mut found = methods(&call.receiver, file)?;
            match method_of(&call.method) {
                Some(method) => found.push(method),
                None if NOT_ROUTING.contains(&call.method.to_string().as_str()) => {}
                None => bail!(
                    "{loc}: the walker does not know the method-router method `{}`",
                    call.method
                ),
            }
            Ok(found)
        }
        Expr::Call(call) => {
            let constructor = match &*call.func {
                Expr::Path(path) => path.path.segments.last().map(|segment| &segment.ident),
                _ => None,
            };
            match constructor.and_then(method_of) {
                Some(method) => Ok(vec![method]),
                None => bail!("{loc}: cannot tell which HTTP methods this serves"),
            }
        }
        _ => bail!("{loc}: cannot tell which HTTP methods this serves"),
    }
}

/// The path axum serves `path` at when its router is nested under `prefix`.
fn nested_path(prefix: &str, path: &str) -> String {
    if prefix.ends_with('/') {
        format!("{prefix}{}", path.trim_start_matches('/'))
    } else if path == "/" {
        prefix.to_owned()
    } else {
        format!("{prefix}{path}")
    }
}

/// Finds the first `.route(..)`, `.nest(..)` or `.merge(..)` call.
#[derive(Default)]
struct RoutingCalls {
    first: Option<proc_macro2::Span>,
}

impl<'ast> Visit<'ast> for RoutingCalls {
    fn visit_expr_method_call(&mut self, call: &'ast ExprMethodCall) {
        if self.first.is_none() && ROUTING.contains(&call.method.to_string().as_str()) {
            self.first = Some(call.method.span());
        }
        syn::visit::visit_expr_method_call(self, call);
    }
}
