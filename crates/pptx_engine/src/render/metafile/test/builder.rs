//! Hand-assembled EMF and WMF byte streams.

/// A `COLORREF`.
pub fn rgb(r: u8, g: u8, b: u8) -> u32 {
    u32::from(r) | u32::from(g) << 8 | u32::from(b) << 16
}

/// Little-endian bytes of 32-bit values.
pub fn le(vals: &[i32]) -> Vec<u8> {
    vals.iter().flat_map(|v| v.to_le_bytes()).collect()
}

/// Little-endian bytes of 16-bit values.
pub fn le16(vals: &[i16]) -> Vec<u8> {
    vals.iter().flat_map(|v| v.to_le_bytes()).collect()
}

/// Bytes of an `f32` sequence.
pub fn lef(vals: &[f32]) -> Vec<u8> {
    vals.iter().flat_map(|v| v.to_le_bytes()).collect()
}

/// A bottom-up 24-bit `BITMAPINFOHEADER` + bits for `rows` (top row first) of RGB pixels.
pub fn dib24(rows: &[&[[u8; 3]]]) -> (Vec<u8>, Vec<u8>) {
    let (w, h) = (rows[0].len(), rows.len());
    let mut bmi = le(&[40, w as i32, h as i32]);
    bmi.extend_from_slice(&1u16.to_le_bytes());
    bmi.extend_from_slice(&24u16.to_le_bytes());
    bmi.extend(le(&[0, 0, 0, 0, 0, 0]));
    let stride = (w * 3).div_ceil(4) * 4;
    let mut bits = Vec::new();
    for row in rows.iter().rev() {
        let mut line: Vec<u8> = row.iter().flat_map(|p| [p[2], p[1], p[0]]).collect();
        line.resize(stride, 0);
        bits.extend(line);
    }
    (bmi, bits)
}

/// A 32-bit top-down DIB with alpha (premultiplied by the caller).
pub fn dib32(w: usize, h: usize, px: [u8; 4]) -> (Vec<u8>, Vec<u8>) {
    let mut bmi = le(&[40, w as i32, -(h as i32)]);
    bmi.extend_from_slice(&1u16.to_le_bytes());
    bmi.extend_from_slice(&32u16.to_le_bytes());
    bmi.extend(le(&[0, 0, 0, 0, 0, 0]));
    let bits = (0..w * h)
        .flat_map(|_| [px[2], px[1], px[0], px[3]])
        .collect();
    (bmi, bits)
}

/// A 1-bit bottom-up DIB with a black/white color table; `rows` top row first, `true` = white.
pub fn dib1(rows: &[&[bool]]) -> (Vec<u8>, Vec<u8>) {
    let (w, h) = (rows[0].len(), rows.len());
    let mut bmi = le(&[40, w as i32, h as i32]);
    bmi.extend_from_slice(&1u16.to_le_bytes());
    bmi.extend_from_slice(&1u16.to_le_bytes());
    bmi.extend(le(&[0, 0, 0, 0, 2, 0]));
    bmi.extend_from_slice(&[0, 0, 0, 0, 255, 255, 255, 0]);
    let stride = w.div_ceil(32) * 4;
    let mut bits = Vec::new();
    for row in rows.iter().rev() {
        let mut line = vec![0u8; stride];
        for (x, &on) in row.iter().enumerate() {
            if on {
                line[x / 8] |= 0x80 >> (x % 8);
            }
        }
        bits.extend(line);
    }
    (bmi, bits)
}

/// An EMF under construction on a 96-DPI reference device (960 × 960 px, 254 × 254 mm).
pub struct Emf {
    records: Vec<u8>,
    count: u32,
    size_px: (i32, i32),
}

impl Emf {
    /// A picture of `w` × `h` device pixels (0.75 pt each).
    pub fn new(w: i32, h: i32) -> Self {
        Self {
            records: Vec::new(),
            count: 0,
            size_px: (w, h),
        }
    }

    /// Appends a record (padded to a multiple of four bytes).
    pub fn rec(&mut self, ty: u32, body: &[u8]) -> &mut Self {
        let size = (8 + body.len()).div_ceil(4) * 4;
        self.records.extend_from_slice(&ty.to_le_bytes());
        self.records.extend_from_slice(&(size as u32).to_le_bytes());
        self.records.extend_from_slice(body);
        self.records
            .resize(self.records.len() + size - 8 - body.len(), 0);
        self.count += 1;
        self
    }

    /// A record with 32-bit integer parameters.
    pub fn ints(&mut self, ty: u32, vals: &[i32]) -> &mut Self {
        self.rec(ty, &le(vals))
    }

    /// The finished file.
    pub fn finish(&self) -> Vec<u8> {
        let (w, h) = self.size_px;
        let frame = |px: i32| (f64::from(px) * 2540.0 / 96.0).round() as i32;
        let mut out = le(&[1, 108, 0, 0, w - 1, h - 1, 0, 0, frame(w), frame(h)]);
        out.extend_from_slice(&0x464D_4520u32.to_le_bytes());
        let total = 108 + self.records.len() + 20;
        out.extend(le(&[0x10000, total as i32, self.count as i32 + 2]));
        out.extend_from_slice(&64u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend(le(&[
            0, 0, 0, 960, 960, 254, 254, 0, 0, 0, 254_000, 254_000,
        ]));
        assert_eq!(out.len(), 108);
        out.extend_from_slice(&self.records);
        out.extend(le(&[14, 20, 0, 16, 20]));
        out
    }

    // ----- Common records -----

    /// `EMR_CREATEPEN`.
    pub fn pen(&mut self, ih: i32, style: i32, width: i32, color: u32) -> &mut Self {
        self.ints(38, &[ih, style, width, 0, color as i32])
    }

    /// `EMR_CREATEBRUSHINDIRECT`.
    pub fn brush(&mut self, ih: i32, style: i32, color: u32, hatch: i32) -> &mut Self {
        self.ints(39, &[ih, style, color as i32, hatch])
    }

    /// `EMR_SELECTOBJECT`.
    pub fn select(&mut self, ih: u32) -> &mut Self {
        self.ints(37, &[ih as i32])
    }

    /// `EMR_RECTANGLE`.
    pub fn rect(&mut self, l: i32, t: i32, r: i32, b: i32) -> &mut Self {
        self.ints(43, &[l, t, r, b])
    }

    /// `EMR_ELLIPSE`.
    pub fn ellipse(&mut self, l: i32, t: i32, r: i32, b: i32) -> &mut Self {
        self.ints(42, &[l, t, r, b])
    }

    /// `EMR_POLYGON16` (or another 16-bit poly record).
    pub fn poly16(&mut self, ty: u32, pts: &[(i16, i16)]) -> &mut Self {
        let mut body = le(&[0, 0, 0, 0, pts.len() as i32]);
        for &(x, y) in pts {
            body.extend(le16(&[x, y]));
        }
        self.rec(ty, &body)
    }

    /// `EMR_EXTCREATEFONTINDIRECTW`.
    pub fn font(
        &mut self,
        ih: i32,
        height: i32,
        escapement: i32,
        weight: i32,
        face: &str,
    ) -> &mut Self {
        let mut body = le(&[ih, height, 0, escapement, escapement, weight]);
        body.extend_from_slice(&[0, 0, 0, 0, 0, 0, 0, 0]);
        let mut name: Vec<u16> = face.encode_utf16().collect();
        name.resize(32, 0);
        body.extend(name.iter().flat_map(|c| c.to_le_bytes()));
        self.rec(82, &body)
    }

    /// `EMR_EXTTEXTOUTW` with an optional advance array.
    pub fn text(
        &mut self,
        x: i32,
        y: i32,
        s: &str,
        dx: Option<&[i32]>,
        options: i32,
        rect: [i32; 4],
    ) -> &mut Self {
        let units: Vec<u16> = s.encode_utf16().collect();
        let n = units.len() as i32;
        let off_string = 76;
        let string_len = (units.len() * 2).div_ceil(4) * 4;
        let off_dx = if dx.is_some() {
            off_string + string_len as i32
        } else {
            0
        };
        let mut body = le(&[0, 0, -1, -1, 1]);
        body.extend(lef(&[0.0, 0.0]));
        body.extend(le(&[
            x, y, n, off_string, options, rect[0], rect[1], rect[2], rect[3], off_dx,
        ]));
        assert_eq!(body.len() + 8, off_string as usize);
        let mut s16: Vec<u8> = units.iter().flat_map(|c| c.to_le_bytes()).collect();
        s16.resize(string_len, 0);
        body.extend(s16);
        if let Some(dx) = dx {
            body.extend(le(dx));
        }
        self.rec(84, &body)
    }

    /// `EMR_STRETCHDIBITS` of a whole DIB onto a logical rectangle.
    pub fn stretch_dib(
        &mut self,
        dest: [i32; 4],
        src: [i32; 4],
        dib: &(Vec<u8>, Vec<u8>),
        rop: u32,
    ) -> &mut Self {
        let (bmi, bits) = dib;
        let off_bmi = 80;
        let off_bits = off_bmi + bmi.len() as i32;
        let mut body = le(&[0, 0, 0, 0, dest[0], dest[1], src[0], src[1], src[2], src[3]]);
        body.extend(le(&[
            off_bmi,
            bmi.len() as i32,
            off_bits,
            bits.len() as i32,
            0,
            rop as i32,
            dest[2],
            dest[3],
        ]));
        body.extend_from_slice(bmi);
        body.extend_from_slice(bits);
        self.rec(81, &body)
    }

    /// `EMR_BITBLT`-family record with an identity source transform
    /// (`EMR_STRETCHBLT` and `EMR_ALPHABLEND` add the source size).
    pub fn blt(
        &mut self,
        ty: u32,
        dest: [i32; 4],
        rop: u32,
        src: [i32; 4],
        dib: Option<&(Vec<u8>, Vec<u8>)>,
    ) -> &mut Self {
        let stretch = ty != 76;
        let header = if stretch { 108 } else { 100 };
        let (bmi, bits) = dib.map_or((&[][..], &[][..]), |(a, b)| (a.as_slice(), b.as_slice()));
        let (off_bmi, off_bits) = (header, header + bmi.len() as i32);
        let mut body = le(&[
            0, 0, 0, 0, dest[0], dest[1], dest[2], dest[3], rop as i32, src[0], src[1],
        ]);
        body.extend(lef(&[1.0, 0.0, 0.0, 1.0, 0.0, 0.0]));
        body.extend(le(&[
            0xFFFFFF,
            0,
            off_bmi,
            bmi.len() as i32,
            off_bits,
            bits.len() as i32,
        ]));
        if stretch {
            body.extend(le(&[src[2], src[3]]));
        }
        assert_eq!(body.len() + 8, header as usize);
        body.extend_from_slice(bmi);
        body.extend_from_slice(bits);
        self.rec(ty, &body)
    }
}

/// A WMF under construction.
pub struct Wmf {
    records: Vec<u8>,
    max: u32,
    placeable: Option<([i16; 4], u16)>,
}

impl Wmf {
    /// A WMF with a placeable header (`bbox` in logical units, `inch` units per inch).
    pub fn placeable(bbox: [i16; 4], inch: u16) -> Self {
        Self {
            records: Vec::new(),
            max: 3,
            placeable: Some((bbox, inch)),
        }
    }

    /// A WMF without a placeable header.
    pub fn plain() -> Self {
        Self {
            records: Vec::new(),
            max: 3,
            placeable: None,
        }
    }

    /// Appends a record with raw parameter bytes (padded to whole words).
    pub fn raw(&mut self, func: u16, params: &[u8]) -> &mut Self {
        let words = 3 + params.len().div_ceil(2);
        self.records
            .extend_from_slice(&(words as u32).to_le_bytes());
        self.records.extend_from_slice(&func.to_le_bytes());
        self.records.extend_from_slice(params);
        if params.len() % 2 == 1 {
            self.records.push(0);
        }
        self.max = self.max.max(words as u32);
        self
    }

    /// Appends a record with 16-bit parameters.
    pub fn rec(&mut self, func: u16, params: &[i16]) -> &mut Self {
        self.raw(func, &le16(params))
    }

    /// The finished file.
    pub fn finish(&self) -> Vec<u8> {
        let mut out = Vec::new();
        if let Some((b, inch)) = self.placeable {
            out.extend_from_slice(&0x9AC6_CDD7u32.to_le_bytes());
            out.extend(le16(&[0, b[0], b[1], b[2], b[3]]));
            out.extend_from_slice(&inch.to_le_bytes());
            out.extend(le(&[0]));
            out.extend(le16(&[0]));
        }
        let size_words = (18 + self.records.len() + 6) / 2;
        out.extend(le16(&[1, 9, 0x300]));
        out.extend_from_slice(&(size_words as u32).to_le_bytes());
        out.extend(le16(&[16]));
        out.extend_from_slice(&self.max.to_le_bytes());
        out.extend(le16(&[0]));
        out.extend_from_slice(&self.records);
        out.extend_from_slice(&3u32.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out
    }
}
