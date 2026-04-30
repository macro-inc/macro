use serde::Deserialize;

pub trait Metadata: for<'de> Deserialize<'de> {
    fn name() -> String;
    fn description() -> Option<String>;
}
