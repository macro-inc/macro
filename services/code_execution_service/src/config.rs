//! Startup configuration; all limits are validated before binding the listener.

#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    #[macro_config_default(8112)]
    pub port: u16,
    /// Dedicated service credential. Never passed into Deno.
    pub code_execution_token: String,
    #[macro_config_default("/usr/local/bin/deno".to_owned())]
    pub deno_binary: String,
    #[macro_config_default("/tmp/code-execution".to_owned())]
    pub deno_scratch_directory: String,
    #[macro_config_default(128)]
    pub deno_heap_mb: u32,
    #[macro_config_default(4)]
    pub max_running: usize,
    #[macro_config_default(16)]
    pub max_queued: usize,
    #[macro_config_default(30_000)]
    pub max_duration_ms: u64,
}
