use macro_env::Environment;
use rootcause::Report;

#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// The instance's Kafka brokers.
    pub kafka_brokers: String,

    #[macro_config_default(9324)]
    pub port: u16,

    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,
}

impl Config {
    pub fn from_env() -> Result<Self, Report> {
        Ok(macro_config::ConfigLoader::load::<Config>()?)
    }
}
