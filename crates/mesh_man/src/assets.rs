//! Figures made from downloaded 3D assets (behind the `demo-assets`
//! feature): line data the `convert` tool wrote from BodyParts3D and rigged
//! glTF characters, decoded at start-up. See `convert/src/format.rs` for the
//! `.mmf` layout.

use glam::Vec3;

use crate::figure::{Core, Figure, FigureBuilder};

/// The asset figures, in viewer order.
const FIGURES: &[&[u8]] = &[
    include_bytes!("../assets/anatomical.mmf"),
    include_bytes!("../assets/rigged.mmf"),
    include_bytes!("../assets/soldier.mmf"),
    include_bytes!("../assets/dancer.mmf"),
];

/// Coordinates are stored as `i16`, figure units times this.
const SCALE: f32 = 32000.0;

/// Every asset figure that decodes; a damaged one is skipped.
pub(crate) fn figures() -> Vec<Figure> {
    FIGURES.iter().filter_map(|bytes| decode(bytes)).collect()
}

/// A cursor over `.mmf` bytes; every read returns `None` past the end.
struct Reader<'a> {
    bytes: &'a [u8],
}

impl<'a> Reader<'a> {
    fn take(&mut self, count: usize) -> Option<&'a [u8]> {
        let (head, rest) = self.bytes.split_at_checked(count)?;
        self.bytes = rest;
        Some(head)
    }

    fn u8(&mut self) -> Option<u8> {
        self.take(1)?.first().copied()
    }

    fn u16(&mut self) -> Option<u16> {
        let bytes = self.take(2)?;
        Some(u16::from_le_bytes(bytes.try_into().ok()?))
    }

    fn u32(&mut self) -> Option<u32> {
        let bytes = self.take(4)?;
        Some(u32::from_le_bytes(bytes.try_into().ok()?))
    }

    fn i16(&mut self) -> Option<i16> {
        let bytes = self.take(2)?;
        Some(i16::from_le_bytes(bytes.try_into().ok()?))
    }

    fn point(&mut self) -> Option<Vec3> {
        let x = f32::from(self.i16()?) / SCALE;
        let y = f32::from(self.i16()?) / SCALE;
        let z = f32::from(self.i16()?) / SCALE;
        Some(Vec3::new(x, y, z))
    }

    fn points(&mut self) -> Option<Vec<Vec3>> {
        let count = self.u16()?;
        (0..count).map(|_| self.point()).collect()
    }

    fn name(&mut self) -> Option<String> {
        let length = self.u8()?;
        String::from_utf8(self.take(usize::from(length))?.to_vec()).ok()
    }
}

fn decode(bytes: &[u8]) -> Option<Figure> {
    let mut reader = Reader { bytes };
    if reader.take(4)? != b"MMF1" {
        return None;
    }
    let mut builder = Figure::builder(reader.name()?);
    let core = reader.u8()?;
    let centre = reader.point()?;
    match core {
        1 => {
            builder.core(Core::Heart(centre));
        }
        2 => {
            builder.core(Core::Reactor(centre));
        }
        _ => {}
    }

    for _ in 0..reader.u32()? {
        let kind = reader.u8()?;
        let points = reader.points()?;
        let add: fn(&mut FigureBuilder, Vec3, Vec3) -> &mut FigureBuilder = match kind {
            0 => FigureBuilder::skin,
            1 => FigureBuilder::bone,
            2 => FigureBuilder::extra,
            3 => FigureBuilder::brain,
            _ => FigureBuilder::nerve_line,
        };
        for pair in points.windows(2) {
            add(&mut builder, pair[0], pair[1]);
        }
    }

    for _ in 0..reader.u16()? {
        let name = reader.name()?;
        let points = reader.points()?;
        builder.nerve(name, points);
    }
    Some(builder.build())
}
