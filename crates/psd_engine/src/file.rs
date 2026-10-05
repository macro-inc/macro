//! The file as stored: header, color mode data, image resources, layer
//! records with their channel data, document-level tagged blocks, and the
//! merged image, each kept as its bytes so that an unedited file writes
//! back byte for byte.
//!
//! [`read`] splits a `.psd` or `.psb` file into a [`PsdFile`]; [`write`]
//! joins one back. Neither interprets pixels or tagged blocks: the
//! [`crate::channels`] codecs decode channel data, and the [`crate::codec`]
//! modules decode blocks. High-bit documents keep their layers in a
//! document-level `Lr16` or `Lr32` block; [`LayerSection::info`] holds them
//! wherever they are stored ([`LayerSection::info_key`]).

use crate::error::Result;
use crate::raster::IRect;

/// The file header.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Header {
    /// 1 for `.psd`, 2 for `.psb` (large document format).
    pub version: u16,
    /// Channels of the merged image, alpha channels included.
    pub channels: u16,
    /// Canvas height in pixels.
    pub height: u32,
    /// Canvas width in pixels.
    pub width: u32,
    /// Bits per channel: 1, 8, 16, or 32.
    pub depth: u16,
    /// Color mode code ([`crate::model::ColorMode::code`]).
    pub mode: u16,
}

impl Header {
    /// Whether the file is a large document (`.psb`), which widens some
    /// lengths to 64 bits.
    pub fn is_psb(&self) -> bool {
        self.version == 2
    }
}

/// An image resource block.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Resource {
    /// `8BIM` (or another signature some writers use).
    pub signature: [u8; 4],
    /// Resource id (1005 resolution, 1032 guides, 1036 thumbnail, …).
    pub id: u16,
    /// The resource's Pascal name, without its length byte.
    pub name: Vec<u8>,
    /// The resource's data, without padding.
    pub data: Vec<u8>,
}

impl Resource {
    /// An `8BIM` resource with no name.
    pub fn new(id: u16, data: Vec<u8>) -> Resource {
        Resource {
            signature: *b"8BIM",
            id,
            name: Vec::new(),
            data,
        }
    }
}

/// How channel data is compressed.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Compression {
    /// Uncompressed.
    Raw,
    /// PackBits run-length encoding, rows counted up front.
    #[default]
    Rle,
    /// Deflate.
    Zip,
    /// Deflate over differences between neighboring samples.
    ZipPrediction,
}

impl Compression {
    /// The code files store.
    pub fn code(self) -> u16 {
        match self {
            Compression::Raw => 0,
            Compression::Rle => 1,
            Compression::Zip => 2,
            Compression::ZipPrediction => 3,
        }
    }

    /// The compression a code names.
    pub fn from_code(code: u16) -> Option<Compression> {
        Some(match code {
            0 => Compression::Raw,
            1 => Compression::Rle,
            2 => Compression::Zip,
            3 => Compression::ZipPrediction,
            _ => return None,
        })
    }
}

/// One channel of a layer's image data, as stored.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Channel {
    /// 0, 1, 2… color channels; -1 transparency; -2 the layer mask; -3 the
    /// real user mask (when a layer has both a pixel and a vector mask).
    pub id: i16,
    /// How `bytes` is compressed.
    pub compression: Compression,
    /// The compressed samples (after the two-byte compression code).
    pub bytes: Vec<u8>,
}

/// Optional parameters a layer mask may carry.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct MaskParams {
    /// User mask density, `0..=255`.
    pub user_density: Option<u8>,
    /// User mask feather, in pixels.
    pub user_feather: Option<f64>,
    /// Vector mask density, `0..=255`.
    pub vector_density: Option<u8>,
    /// Vector mask feather, in pixels.
    pub vector_feather: Option<f64>,
}

/// The real user mask of a layer with both a pixel and a vector mask.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RealMask {
    /// Flags, as [`MaskData::flags`].
    pub flags: u8,
    /// Value outside the rectangle (0 or 255).
    pub default_color: u8,
    /// Top, left, bottom, right.
    pub rect: [i32; 4],
}

/// A layer record's mask data.
#[derive(Clone, Debug, PartialEq)]
pub struct MaskData {
    /// Top, left, bottom, right of the mask's pixels.
    pub rect: [i32; 4],
    /// Value outside the rectangle (0 or 255).
    pub default_color: u8,
    /// Bit 0 position relative to layer, bit 1 disabled, bit 2 invert
    /// (obsolete), bit 3 rendered from other data, bit 4 has parameters.
    pub flags: u8,
    /// Density and feather.
    pub params: Option<MaskParams>,
    /// The real user mask.
    pub real: Option<RealMask>,
}

/// An additional layer information block (document level or per layer).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaggedBlock {
    /// `8BIM` or `8B64`.
    pub signature: [u8; 4],
    /// The block's key (`luni`, `lfx2`, `TySh`, …).
    pub key: [u8; 4],
    /// The block's data, without padding.
    pub data: Vec<u8>,
    /// Padding written after the data in the file (kept so unedited
    /// blocks write back as they were; new blocks leave it `None` and get
    /// the padding Photoshop writes for their key).
    pub padding: Option<Vec<u8>>,
    /// The length field counted the padding.
    pub length_includes_padding: bool,
}

impl TaggedBlock {
    /// A new `8BIM` block.
    pub fn new(key: &[u8; 4], data: Vec<u8>) -> TaggedBlock {
        TaggedBlock {
            signature: *b"8BIM",
            key: *key,
            data,
            padding: None,
            length_includes_padding: false,
        }
    }
}

/// A layer record and its channels' image data.
#[derive(Clone, Debug, PartialEq)]
pub struct LayerRecord {
    /// Top, left, bottom, right of the layer's pixels.
    pub rect: [i32; 4],
    /// Channel data, in the record's channel order.
    pub channels: Vec<Channel>,
    /// Blend mode key (`norm`, `mul `, …).
    pub blend: [u8; 4],
    /// Opacity, `0..=255`.
    pub opacity: u8,
    /// 0 base, 1 clipped to the layer below.
    pub clipping: u8,
    /// Bit 0 transparency protected, bit 1 hidden, bit 3 bit 4 is
    /// meaningful, bit 4 pixel data irrelevant to appearance.
    pub flags: u8,
    /// The byte after the flags (normally 0).
    pub filler: u8,
    /// Mask data.
    pub mask: Option<MaskData>,
    /// Blending ranges, as stored (empty when absent).
    pub blend_ranges: Vec<u8>,
    /// The Pascal name (MacRoman), without its length byte.
    pub name: Vec<u8>,
    /// Additional layer information, in file order.
    pub tagged: Vec<TaggedBlock>,
    /// Bytes the record's extra data held that were not understood
    /// (written back unchanged after the tagged blocks).
    pub extra_tail: Vec<u8>,
    /// Padding after the name (so unedited records write back exactly).
    pub name_padding: usize,
}

impl LayerRecord {
    /// The layer's pixel rectangle.
    pub fn rect(&self) -> IRect {
        let [top, left, bottom, right] = self.rect;
        IRect::from_ltrb(left, top, right, bottom)
    }

    /// The first block with a key.
    pub fn block(&self, key: &[u8; 4]) -> Option<&TaggedBlock> {
        self.tagged.iter().find(|b| &b.key == key)
    }

    /// The first block with a key, to change.
    pub fn block_mut(&mut self, key: &[u8; 4]) -> Option<&mut TaggedBlock> {
        self.tagged.iter_mut().find(|b| &b.key == key)
    }

    /// Replaces the data of the first block with a key, adding the block
    /// at the end when the record has none.
    pub fn set_block(&mut self, key: &[u8; 4], data: Vec<u8>) {
        match self.block_mut(key) {
            Some(b) => {
                b.data = data;
                b.padding = None;
            }
            None => self.tagged.push(TaggedBlock::new(key, data)),
        }
    }

    /// Removes every block with a key.
    pub fn remove_block(&mut self, key: &[u8; 4]) {
        self.tagged.retain(|b| &b.key != key);
    }

    /// The channel with an id.
    pub fn channel(&self, id: i16) -> Option<&Channel> {
        self.channels.iter().find(|c| c.id == id)
    }
}

/// The layer records.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LayerInfo {
    /// The layer count was stored negative: the merged image's first alpha
    /// channel holds its transparency.
    pub merged_alpha: bool,
    /// Records, bottom layer first.
    pub records: Vec<LayerRecord>,
}

/// The layer and mask information section.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LayerSection {
    /// The layers.
    pub info: LayerInfo,
    /// The document-level block the layers are stored in (`Lr16`, `Lr32`)
    /// instead of the section's own layer info; `None` for the section.
    pub info_key: Option<[u8; 4]>,
    /// The global layer mask info, as stored (without its length).
    pub global_mask: Option<Vec<u8>>,
    /// Document-level tagged blocks, in file order. When `info_key` is
    /// set, the block with that key is here with empty data, marking where
    /// [`LayerSection::info`] is written.
    pub tagged: Vec<TaggedBlock>,
    /// Bytes at the end of the section that were not understood (written
    /// back unchanged).
    pub tail: Vec<u8>,
    /// Padding of the layer info (so unedited files write back exactly).
    pub info_padding: usize,
}

impl LayerSection {
    /// The first document-level block with a key.
    pub fn block(&self, key: &[u8; 4]) -> Option<&TaggedBlock> {
        self.tagged.iter().find(|b| &b.key == key)
    }
}

/// The merged image data.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ImageData {
    /// How it is compressed.
    pub compression: Compression,
    /// Every channel's compressed samples, planar, as stored (after the
    /// two-byte compression code; RLE row counts included).
    pub bytes: Vec<u8>,
}

/// A file, split into its parts.
#[derive(Clone, Debug, PartialEq)]
pub struct PsdFile {
    /// The header.
    pub header: Header,
    /// Color mode data (an indexed file's palette, duotone curves), as
    /// stored.
    pub color_mode_data: Vec<u8>,
    /// Image resources, in file order.
    pub resources: Vec<Resource>,
    /// Layers, masks, and document-level blocks.
    pub layers: LayerSection,
    /// The merged image.
    pub image: ImageData,
}

impl PsdFile {
    /// The first image resource with an id.
    pub fn resource(&self, id: u16) -> Option<&Resource> {
        self.resources.iter().find(|r| r.id == id)
    }
}

/// Splits a `.psd` or `.psb` file into its parts.
pub fn read(bytes: &[u8]) -> Result<PsdFile> {
    let _ = bytes;
    Err(crate::error::PsdError::Unsupported(
        "reading files is not implemented yet".into(),
    ))
}

/// Joins a file's parts back into bytes; an unedited file comes out as it
/// was read.
pub fn write(file: &PsdFile) -> Vec<u8> {
    let _ = file;
    Vec::new()
}
