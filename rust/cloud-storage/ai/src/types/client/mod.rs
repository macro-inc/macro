pub mod anthropic;
pub mod openrouter;
pub mod traits;
pub use anthropic::AnthropicClient;
pub use openrouter::OpenRouterClient;
pub use traits::{Client, RequestExtensions};
pub mod noop;
