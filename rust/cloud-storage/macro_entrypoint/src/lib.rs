#![deny(missing_docs)]
//! This crate provides a standardized initialization process that should be used across entrypoint crates.
//! This is used to provide consistent behaviour with e.g. tracing configurations

use macro_env::Environment;
use tracing_subscriber::{EnvFilter, Registry, layer::SubscriberExt};
use tracing_tree::HierarchicalLayer;

/// unit struct which defines the behaviour for instantiation
#[derive(Debug)]
pub struct MacroEntrypoint {
    env: Environment,
    /// describes options that only apply in local dev
    local: LocalOptions,
}

impl Default for MacroEntrypoint {
    fn default() -> Self {
        MacroEntrypoint {
            env: Environment::new_or_prod(),
            local: Default::default(),
        }
    }
}

/// sentinel struct which guarantees that we called [MacroEntrypoint::init]
#[derive(Debug)]
pub struct InitializedEntrypoint(());

impl MacroEntrypoint {
    /// create a new instance of [Self] from an input [Environment]
    pub fn new(env: Environment) -> Self {
        Self {
            env,
            ..Default::default()
        }
    }

    /// consume self, initialize this binary, and return a proof that it was initialized [InitializedEntrypoint]
    pub fn init(self) -> InitializedEntrypoint {
        dotenv::dotenv().ok();
        std::panic::set_hook(Box::new(tracing_panic::panic_hook));

        match (self.env, self.local) {
            (Environment::Local, LocalOptions { tree_tracing: None }) => {
                tracing_subscriber::fmt()
                    .with_ansi(true)
                    .with_env_filter(EnvFilter::from_default_env())
                    .with_file(true)
                    .with_line_number(true)
                    .pretty()
                    .init();
            }
            (
                Environment::Local,
                LocalOptions {
                    tree_tracing: Some(level),
                },
            ) => {
                let subscriber = Registry::default().with(HierarchicalLayer::new(level));
                tracing::subscriber::set_global_default(subscriber).unwrap();
            }
            (Environment::Production | Environment::Develop, _) => {
                tracing_subscriber::fmt()
                    .with_ansi(false)
                    .with_env_filter(EnvFilter::from_default_env())
                    .with_file(true)
                    .with_line_number(true)
                    .json()
                    .with_current_span(true)
                    .with_span_list(false)
                    .flatten_event(true)
                    .init();
            }
        }

        InitializedEntrypoint(())
    }

    /// begin modifying the options for the local environment
    pub fn local(self) -> LocalOptionsBuilder {
        LocalOptionsBuilder {
            prev: self,
            next: Default::default(),
        }
    }
}

/// builder struct for modifying the local environment options
pub struct LocalOptionsBuilder {
    prev: MacroEntrypoint,
    next: LocalOptions,
}

impl LocalOptionsBuilder {
    /// change the options for tree_tracing
    pub fn tree_tracing(mut self, val: Option<usize>) -> Self {
        self.next.tree_tracing = val;
        self
    }

    /// finish modifying the options for the local environment
    pub fn build(self) -> MacroEntrypoint {
        MacroEntrypoint {
            env: self.prev.env,
            local: self.next,
        }
    }
}

#[derive(Debug, Default)]
struct LocalOptions {
    tree_tracing: Option<usize>,
}
