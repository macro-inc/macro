//! A baseline JPEG encoder: 8×8 DCT, the standard quantization tables
//! scaled by quality (as libjpeg scales them), and the standard Huffman
//! tables, with no chroma subsampling. Transparent pixels are composited
//! over white, as Figma's JPG export does.

/// The luminance quantization table (natural order), quality 50.
const LUMA_Q: [u16; 64] = [
    16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
    14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113,
    92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];

/// The chrominance quantization table (natural order), quality 50.
const CHROMA_Q: [u16; 64] = [
    17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99,
    47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
];

/// Zigzag position → natural index.
const ZIGZAG: [usize; 64] = [
    0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20,
    13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59,
    52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];

const DC_LUMA_BITS: [u8; 16] = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_CHROMA_BITS: [u8; 16] = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const DC_VALUES: [u8; 12] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

const AC_LUMA_BITS: [u8; 16] = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_LUMA_VALUES: [u8; 162] = [
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
    0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
    0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
    0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
    0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
    0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
    0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa,
];

const AC_CHROMA_BITS: [u8; 16] = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
const AC_CHROMA_VALUES: [u8; 162] = [
    0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
    0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
    0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
    0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
    0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
    0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
    0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
    0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
    0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
    0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa,
];

/// A Huffman table as codes (and their lengths) by symbol.
struct Huffman {
    codes: [(u16, u8); 256],
}

impl Huffman {
    fn new(bits: &[u8; 16], values: &[u8]) -> Huffman {
        let mut codes = [(0u16, 0u8); 256];
        let mut code = 0u16;
        let mut k = 0;
        for (len, &count) in bits.iter().enumerate() {
            for _ in 0..count {
                codes[values[k] as usize] = (code, len as u8 + 1);
                code += 1;
                k += 1;
            }
            code <<= 1;
        }
        Huffman { codes }
    }
}

/// Entropy-coded bits, with 0xFF bytes stuffed.
#[derive(Default)]
struct Bits {
    out: Vec<u8>,
    acc: u32,
    count: u32,
}

impl Bits {
    fn put(&mut self, value: u32, len: u8) {
        if len == 0 {
            return;
        }
        self.acc = (self.acc << len) | (value & ((1 << len) - 1));
        self.count += u32::from(len);
        while self.count >= 8 {
            let byte = (self.acc >> (self.count - 8)) as u8;
            self.out.push(byte);
            if byte == 0xFF {
                self.out.push(0);
            }
            self.count -= 8;
        }
        self.acc &= (1 << self.count) - 1;
    }

    fn code(&mut self, table: &Huffman, symbol: u8) {
        let (code, len) = table.codes[symbol as usize];
        self.put(u32::from(code), len);
    }

    fn finish(mut self) -> Vec<u8> {
        // Pad with ones to a byte boundary.
        let pad = (8 - self.count % 8) % 8;
        self.put((1 << pad) - 1, pad as u8);
        self.out
    }
}

/// The quantization table for `quality` (1–100), as libjpeg scales it.
fn scaled(table: &[u16; 64], quality: u8) -> [u16; 64] {
    let q = u32::from(quality.clamp(1, 100));
    let scale = if q < 50 { 5000 / q } else { 200 - 2 * q };
    let mut out = [0u16; 64];
    for (o, &t) in out.iter_mut().zip(table) {
        *o = ((u32::from(t) * scale + 50) / 100).clamp(1, 255) as u16;
    }
    out
}

/// `cos((2x + 1) u π / 16)` times the DCT's normalization.
fn dct_basis() -> [[f32; 8]; 8] {
    let mut b = [[0f32; 8]; 8];
    for (u, row) in b.iter_mut().enumerate() {
        let c = if u == 0 { 0.5 / 2f32.sqrt() } else { 0.5 };
        for (x, v) in row.iter_mut().enumerate() {
            *v = c * (((2 * x + 1) as f32 * u as f32 * std::f32::consts::PI) / 16.0).cos();
        }
    }
    b
}

/// One block's quantized coefficients (natural order).
fn transform(block: &[f32; 64], basis: &[[f32; 8]; 8], q: &[u16; 64]) -> [i32; 64] {
    let mut rows = [0f32; 64];
    for y in 0..8 {
        for u in 0..8 {
            rows[y * 8 + u] = (0..8).map(|x| block[y * 8 + x] * basis[u][x]).sum();
        }
    }
    let mut out = [0i32; 64];
    for v in 0..8 {
        for u in 0..8 {
            let f: f32 = (0..8).map(|y| rows[y * 8 + u] * basis[v][y]).sum();
            out[v * 8 + u] = (f / f32::from(q[v * 8 + u])).round() as i32;
        }
    }
    out
}

/// The bit count of `v`'s magnitude, and its bits as JPEG writes them.
fn category(v: i32) -> (u8, u32) {
    let size = (32 - v.unsigned_abs().leading_zeros()) as u8;
    let bits = if v < 0 { v - 1 } else { v } as u32;
    (size, bits)
}

fn encode_block(
    bits: &mut Bits,
    coefficients: &[i32; 64],
    previous_dc: &mut i32,
    dc: &Huffman,
    ac: &Huffman,
) {
    let diff = coefficients[0] - *previous_dc;
    *previous_dc = coefficients[0];
    let (size, value) = category(diff);
    bits.code(dc, size);
    bits.put(value, size);
    let mut run = 0u8;
    for &k in &ZIGZAG[1..] {
        let c = coefficients[k];
        if c == 0 {
            run += 1;
            continue;
        }
        while run >= 16 {
            bits.code(ac, 0xF0);
            run -= 16;
        }
        let (size, value) = category(c);
        bits.code(ac, (run << 4) | size);
        bits.put(value, size);
        run = 0;
    }
    if run > 0 {
        bits.code(ac, 0x00);
    }
}

fn segment(out: &mut Vec<u8>, marker: u8, body: &[u8]) {
    out.extend_from_slice(&[0xFF, marker]);
    out.extend_from_slice(&((body.len() + 2) as u16).to_be_bytes());
    out.extend_from_slice(body);
}

/// Encodes premultiplied RGBA pixels (`width × height × 4` bytes) as a
/// baseline JPEG at `quality` (1–100), over white.
pub fn encode(rgba: &[u8], width: u32, height: u32, quality: u8) -> Vec<u8> {
    let (w, h) = (width.max(1) as usize, height.max(1) as usize);
    let luma_q = scaled(&LUMA_Q, quality);
    let chroma_q = scaled(&CHROMA_Q, quality);
    let mut out = vec![0xFF, 0xD8];
    segment(
        &mut out,
        0xE0,
        &[b'J', b'F', b'I', b'F', 0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
    );
    for (id, table) in [(0u8, &luma_q), (1, &chroma_q)] {
        let mut body = vec![id];
        body.extend(ZIGZAG.iter().map(|&k| table[k] as u8));
        segment(&mut out, 0xDB, &body);
    }
    let mut sof = vec![8];
    sof.extend_from_slice(&(h as u16).to_be_bytes());
    sof.extend_from_slice(&(w as u16).to_be_bytes());
    sof.push(3);
    for (id, table) in [(1u8, 0u8), (2, 1), (3, 1)] {
        sof.extend_from_slice(&[id, 0x11, table]);
    }
    segment(&mut out, 0xC0, &sof);
    for (class_id, counts, values) in [
        (0x00u8, &DC_LUMA_BITS, &DC_VALUES[..]),
        (0x10, &AC_LUMA_BITS, &AC_LUMA_VALUES[..]),
        (0x01, &DC_CHROMA_BITS, &DC_VALUES[..]),
        (0x11, &AC_CHROMA_BITS, &AC_CHROMA_VALUES[..]),
    ] {
        let mut body = vec![class_id];
        body.extend_from_slice(counts);
        body.extend_from_slice(values);
        segment(&mut out, 0xC4, &body);
    }
    segment(&mut out, 0xDA, &[3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]);

    let dc = [
        Huffman::new(&DC_LUMA_BITS, &DC_VALUES),
        Huffman::new(&DC_CHROMA_BITS, &DC_VALUES),
    ];
    let ac = [
        Huffman::new(&AC_LUMA_BITS, &AC_LUMA_VALUES),
        Huffman::new(&AC_CHROMA_BITS, &AC_CHROMA_VALUES),
    ];
    let basis = dct_basis();
    let mut bits = Bits::default();
    let mut previous = [0i32; 3];
    let mut blocks = [[0f32; 64]; 3];
    for by in (0..h).step_by(8) {
        for bx in (0..w).step_by(8) {
            for y in 0..8 {
                // Edge blocks repeat the last row and column.
                let sy = (by + y).min(h - 1);
                for x in 0..8 {
                    let sx = (bx + x).min(w - 1);
                    let p = (sy * w + sx) * 4;
                    let px = rgba.get(p..p + 4).unwrap_or(&[0, 0, 0, 0]);
                    // Premultiplied over white.
                    let under = 255.0 - f32::from(px[3]);
                    let r = f32::from(px[0]) + under;
                    let g = f32::from(px[1]) + under;
                    let b = f32::from(px[2]) + under;
                    let k = y * 8 + x;
                    blocks[0][k] = 0.299 * r + 0.587 * g + 0.114 * b - 128.0;
                    blocks[1][k] = -0.168_736 * r - 0.331_264 * g + 0.5 * b;
                    blocks[2][k] = 0.5 * r - 0.418_688 * g - 0.081_312 * b;
                }
            }
            for (c, block) in blocks.iter().enumerate() {
                let table = if c == 0 { &luma_q } else { &chroma_q };
                let coefficients = transform(block, &basis, table);
                let t = usize::from(c != 0);
                encode_block(&mut bits, &coefficients, &mut previous[c], &dc[t], &ac[t]);
            }
        }
    }
    out.extend_from_slice(&bits.finish());
    out.extend_from_slice(&[0xFF, 0xD9]);
    out
}
