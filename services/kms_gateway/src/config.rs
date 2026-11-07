use macro_env::Environment;
use rootcause::Report;

#[derive(macro_config::MacroConfig)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct Config {
    /// The instance's OpenBao.
    pub openbao_addr: String,

    /// A token limited to transit.
    pub openbao_token: String,

    #[macro_config_default(8080)]
    pub port: u16,

    #[macro_config_default(Environment::new_or_prod())]
    pub environment: Environment,
}

impl Config {
    pub fn from_env() -> Result<Self, Report> {
        Ok(macro_config::ConfigLoader::load::<Config>()?)
    }
}
