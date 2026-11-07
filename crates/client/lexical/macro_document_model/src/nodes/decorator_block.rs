//! Macro block decorators keep alignment in memory, separate from their wire payload.
use super::*;
/// Nonserialized block alignment.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct DecoratorBlockData {
    /// Alignment used by the attached view.
    pub format: ElementFormat,
}
impl DecoratorBlockData {
    /// Constructor alignment for cards, media and pastes.
    pub fn center() -> Self {
        Self {
            format: ElementFormat::Center,
        }
    }
    /// Constructor alignment for rendered HTML.
    pub fn left() -> Self {
        Self {
            format: ElementFormat::Left,
        }
    }
}
/// Composition interface for Macro's abstract block decorator.
pub trait DecoratorBlock: DecoratorNode {
    /// Read block properties.
    fn block(&self) -> &DecoratorBlockData;
    /// Write block properties.
    fn block_mut(&mut self) -> &mut DecoratorBlockData;
}
/// Change display alignment without adding a serialized format property.
pub fn set_decorator_block_format<T: DecoratorBlock>(
    tx: &mut Transaction<'_>,
    id: Id<T>,
    format: ElementFormat,
) -> crate::Result<()> {
    tx.get_mut::<T>(id)?.block_mut().format = format;
    Ok(())
}
/// Whether the node belongs to the block-decorator family.
pub fn is_decorator_block(state: &impl Read, key: NodeKey) -> bool {
    state.is::<DocumentCardNode>(key)
        || state.is::<ImageNode>(key)
        || state.is::<VideoNode>(key)
        || state.is::<PasteNode>(key)
        || state.is::<HtmlRenderNode>(key)
        || state.is::<HorizontalRuleNode>(key)
}
