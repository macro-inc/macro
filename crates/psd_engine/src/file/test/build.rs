//! Files assembled byte by byte, quirks included, so the tests do not rely
//! on the writer they check.

/// Big-endian bytes under construction.
#[derive(Clone, Debug, Default)]
pub(crate) struct Out(pub Vec<u8>);

impl Out {
    pub fn u8(&mut self, v: u8) -> &mut Self {
        self.0.push(v);
        self
    }

    pub fn u16(&mut self, v: u16) -> &mut Self {
        self.bytes(&v.to_be_bytes())
    }

    pub fn i16(&mut self, v: i16) -> &mut Self {
        self.bytes(&v.to_be_bytes())
    }

    pub fn u32(&mut self, v: u32) -> &mut Self {
        self.bytes(&v.to_be_bytes())
    }

    pub fn i32(&mut self, v: i32) -> &mut Self {
        self.bytes(&v.to_be_bytes())
    }

    pub fn bytes(&mut self, b: &[u8]) -> &mut Self {
        self.0.extend_from_slice(b);
        self
    }

    /// A 32-bit length, or 64-bit when `large`.
    pub fn length(&mut self, n: usize, large: bool) -> &mut Self {
        if large {
            self.bytes(&(n as u64).to_be_bytes())
        } else {
            self.u32(n as u32)
        }
    }

    /// A length-prefixed part.
    pub fn part(&mut self, large: bool, body: &[u8]) -> &mut Self {
        self.length(body.len(), large).bytes(body)
    }
}

/// A whole file.
#[derive(Clone, Debug)]
pub(crate) struct Spec {
    pub psb: bool,
    pub channels: u16,
    pub width: u32,
    pub height: u32,
    pub depth: u16,
    pub mode: u16,
    pub color_mode_data: Vec<u8>,
    /// The resource section's content.
    pub resources: Vec<u8>,
    /// The layer and mask section's content (empty for none).
    pub layers: Vec<u8>,
    /// The merged image: a compression code, then the data.
    pub image: Vec<u8>,
}

impl Spec {
    /// A 2×2 RGB file without layers, with a raw merged image.
    pub fn rgb() -> Spec {
        Spec {
            psb: false,
            channels: 3,
            width: 2,
            height: 2,
            depth: 8,
            mode: 3,
            color_mode_data: Vec::new(),
            resources: Vec::new(),
            layers: Vec::new(),
            image: [&[0, 0][..], &[10; 12]].concat(),
        }
    }

    pub fn bytes(&self) -> Vec<u8> {
        let mut out = Out::default();
        out.bytes(b"8BPS")
            .u16(if self.psb { 2 } else { 1 })
            .bytes(&[0; 6])
            .u16(self.channels)
            .u32(self.height)
            .u32(self.width)
            .u16(self.depth)
            .u16(self.mode)
            .part(false, &self.color_mode_data)
            .part(false, &self.resources)
            .part(self.psb, &self.layers)
            .bytes(&self.image);
        out.0
    }
}

/// An image resource block.
pub(crate) fn resource(id: u16, name: &[u8], data: &[u8]) -> Vec<u8> {
    let mut out = Out::default();
    out.bytes(b"8BIM").u16(id).u8(name.len() as u8).bytes(name);
    if (name.len() + 1) % 2 == 1 {
        out.u8(0);
    }
    out.part(false, data);
    if data.len() % 2 == 1 {
        out.u8(0);
    }
    out.0
}

/// A tagged block: signature, key, a length counting `data` (and the
/// first `counted` bytes of `padding`), the data, then `padding`.
pub(crate) fn block(
    signature: &[u8; 4],
    key: &[u8; 4],
    large: bool,
    data: &[u8],
    padding: &[u8],
    counted: usize,
) -> Vec<u8> {
    let mut out = Out::default();
    out.bytes(signature)
        .bytes(key)
        .length(data.len() + counted, large)
        .bytes(data)
        .bytes(padding);
    out.0
}

/// A layer record and its channels' data (compression code included).
#[derive(Clone, Debug)]
pub(crate) struct Layer {
    pub rect: [i32; 4],
    pub channels: Vec<(i16, Vec<u8>)>,
    pub blend: [u8; 4],
    pub opacity: u8,
    pub clipping: u8,
    pub flags: u8,
    pub filler: u8,
    pub mask: Vec<u8>,
    pub ranges: Vec<u8>,
    pub name: Vec<u8>,
    /// Zero bytes after the name.
    pub name_padding: usize,
    /// Everything after the name's padding (blocks and whatever else).
    pub rest: Vec<u8>,
}

impl Layer {
    /// A 2×1 RGB layer with raw channels and Photoshop's padding.
    pub fn new(name: &[u8]) -> Layer {
        Layer {
            rect: [0, 0, 1, 2],
            channels: vec![
                (-1, vec![0, 0, 255, 128]),
                (0, vec![0, 0, 1, 2]),
                (1, vec![0, 0, 3, 4]),
                (2, vec![0, 0, 5, 6]),
            ],
            blend: *b"norm",
            opacity: 255,
            clipping: 0,
            flags: 8,
            filler: 0,
            mask: Vec::new(),
            ranges: vec![0, 0, 255, 255, 0, 0, 255, 255],
            name: name.to_vec(),
            name_padding: (4 - (name.len() + 1) % 4) % 4,
            rest: Vec::new(),
        }
    }

    fn record(&self, out: &mut Out, psb: bool) {
        for v in self.rect {
            out.i32(v);
        }
        out.u16(self.channels.len() as u16);
        for (id, data) in &self.channels {
            out.i16(*id).length(data.len(), psb);
        }
        out.bytes(b"8BIM")
            .bytes(&self.blend)
            .u8(self.opacity)
            .u8(self.clipping)
            .u8(self.flags)
            .u8(self.filler);
        let mut extra = Out::default();
        extra
            .part(false, &self.mask)
            .part(false, &self.ranges)
            .u8(self.name.len() as u8)
            .bytes(&self.name)
            .bytes(&vec![0; self.name_padding])
            .bytes(&self.rest);
        out.part(false, &extra.0);
    }
}

/// Layer info content: the count, records, then channel data.
pub(crate) fn layer_info(count: i16, layers: &[Layer], psb: bool) -> Vec<u8> {
    let mut out = Out::default();
    out.i16(count);
    for layer in layers {
        layer.record(&mut out, psb);
    }
    for layer in layers {
        for (_, data) in &layer.channels {
            out.bytes(data);
        }
    }
    out.0
}

/// A layer and mask section's content: the layer info padded with
/// `info_padding` zeros, the global mask info, then `rest`.
pub(crate) fn section(
    info: &[u8],
    info_padding: usize,
    psb: bool,
    global_mask: Option<&[u8]>,
    rest: &[u8],
) -> Vec<u8> {
    let mut out = Out::default();
    out.part(psb, &[info, &vec![0; info_padding]].concat());
    if let Some(mask) = global_mask {
        out.part(false, mask);
    }
    out.bytes(rest);
    out.0
}

/// Photoshop's global layer mask info.
pub(crate) const GLOBAL_MASK: [u8; 16] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100, 128, 0, 0, 0];
