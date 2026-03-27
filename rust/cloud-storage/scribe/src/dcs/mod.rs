mod client;
pub use client::DcsClient;
use sqlx::{Pool, Postgres};

use crate::client::ScribeClient;

impl<D, C, A, E, S> ScribeClient<D, C, A, E, S> {
    pub fn with_dcs_client(self, db: Pool<Postgres>) -> ScribeClient<D, C, DcsClient, E, S> {
        let dcs_client = DcsClient::new(db);
        ScribeClient {
            channel: self.channel,
            chat: dcs_client,
            document: self.document,
            email: self.email,
            static_file: self.static_file,
        }
    }
}
