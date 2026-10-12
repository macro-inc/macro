//! Composition of the typed API readers the import service uses.

use super::linear::NoLinearSource;
use super::notion::{NoImageRehoster, NoNotionSource};
use crate::domain::ports::{ImageRehoster, ImportApis, LinearSource, NotionSource};

/// The concrete API readers a host wires into the import service.
pub struct ApiSources<L, N, I> {
    linear: L,
    notion: N,
    images: I,
}

impl<L: LinearSource, N: NotionSource, I: ImageRehoster> ApiSources<L, N, I> {
    /// Bundle the readers.
    pub fn new(linear: L, notion: N, images: I) -> Self {
        Self {
            linear,
            notion,
            images,
        }
    }
}

impl<L: LinearSource, N: NotionSource, I: ImageRehoster> ImportApis for ApiSources<L, N, I> {
    type Linear = L;
    type Notion = N;
    type Images = I;

    fn linear(&self) -> &L {
        &self.linear
    }

    fn notion(&self) -> &N {
        &self.notion
    }

    fn images(&self) -> &I {
        &self.images
    }
}

/// Default for hosts without API readers: every source reports not connected.
pub type NoApiSources = ApiSources<NoLinearSource, NoNotionSource, NoImageRehoster>;

impl Default for NoApiSources {
    fn default() -> Self {
        Self::new(NoLinearSource, NoNotionSource, NoImageRehoster)
    }
}
