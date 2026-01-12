pub use ai_format::traits::TextAttachment;

use serde::Deserialize;

pub trait Metadata: for<'de> Deserialize<'de> {
    fn name() -> String;
    fn description() -> Option<String>;
}
