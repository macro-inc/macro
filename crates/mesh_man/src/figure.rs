//! Figures: the line drawings the body can wear.
//!
//! A [`Figure`] is a named set of straight segments in three tissue layers
//! (skin, bone and an optional extra layer such as muscles or organs), the
//! brain's lines, nerve paths for pulses, and an optional heart. Every figure
//! uses the same units, so procedural and asset-based figures go through the
//! same projection, layering and pulse code: 2.0 tall, feet at `y = -1`,
//! crown at `y = +1`, centred on the pelvis, `+x` its left, `+z` the way it
//! faces, every point inside `[-1, 1]^3`.

use glam::Vec3;

/// Which tissue a static segment belongs to; it picks the segment's layer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Tissue {
    Skin,
    Bone,
    /// Muscles, organs or anything else drawn between skin and bone.
    Extra,
}

/// One straight piece of the static figure.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Segment {
    pub a: Vec3,
    pub b: Vec3,
    pub tissue: Tissue,
}

/// A nerve: a named polyline from the brain outward, with cumulative lengths.
#[derive(Clone, Debug)]
pub(crate) struct NervePath {
    pub name: String,
    pub points: Vec<Vec3>,
    /// `lengths[i]` is the distance along the path from `points[0]` to `points[i]`.
    pub lengths: Vec<f32>,
}

impl NervePath {
    pub(crate) fn new(name: String, points: Vec<Vec3>) -> Self {
        let mut lengths = Vec::with_capacity(points.len());
        let mut total = 0.0;
        let mut previous = points.first().copied().unwrap_or(Vec3::ZERO);

        for point in &points {
            total += point.distance(previous);
            lengths.push(total);
            previous = *point;
        }

        Self {
            name,
            points,
            lengths,
        }
    }

    /// The path's total length.
    pub fn length(&self) -> f32 {
        self.lengths.last().copied().unwrap_or(0.0)
    }

    /// The point at distance `s` along the path, clamped to its ends.
    pub fn point_at(&self, s: f32) -> Vec3 {
        let s = s.clamp(0.0, self.length());

        for (index, pair) in self.points.windows(2).enumerate() {
            let start = self.lengths.get(index).copied().unwrap_or(0.0);
            let end = self.lengths.get(index + 1).copied().unwrap_or(start);

            if s <= end {
                let span = end - start;
                let t = if span > 0.0 { (s - start) / span } else { 0.0 };
                return pair[0].lerp(pair[1], t);
            }
        }

        self.points.last().copied().unwrap_or(Vec3::ZERO)
    }

    /// The far end of the path.
    pub fn end(&self) -> Vec3 {
        self.points.last().copied().unwrap_or(Vec3::ZERO)
    }
}

/// A figure the body can wear: line layers, brain, nerves and heart, in the
/// shared figure units (see the module docs). Build one with
/// [`Figure::builder`].
#[derive(Clone, Debug)]
pub struct Figure {
    pub(crate) name: String,
    pub(crate) segments: Vec<Segment>,
    /// The brain's lines, drawn with the nerves.
    pub(crate) brain: Vec<(Vec3, Vec3)>,
    pub(crate) nerves: Vec<NervePath>,
    /// Nerve lines drawn but not pulsed along, such as the twigs of a
    /// branching tree; drawn in the resting nerve colour.
    pub(crate) nerve_lines: Vec<(Vec3, Vec3)>,
    /// What beats in the chest, if anything.
    pub(crate) core: Option<Core>,
}

/// What beats in a figure's chest.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Core {
    /// A heart-shaped loop centred here, swelling on each beat.
    Heart(Vec3),
    /// A glowing reactor ring centred here, pulsing on each beat.
    Reactor(Vec3),
}

impl Core {
    /// Where it sits.
    pub fn centre(self) -> Vec3 {
        match self {
            Core::Heart(centre) | Core::Reactor(centre) => centre,
        }
    }

    fn map(self, map: impl Fn(Vec3) -> Vec3) -> Self {
        match self {
            Core::Heart(centre) => Core::Heart(map(centre)),
            Core::Reactor(centre) => Core::Reactor(map(centre)),
        }
    }
}

impl Figure {
    /// Starts a figure called `name` (shown in titles, such as `SKELETAL`).
    pub fn builder(name: impl Into<String>) -> FigureBuilder {
        FigureBuilder {
            figure: Figure {
                name: name.into(),
                segments: Vec::new(),
                brain: Vec::new(),
                nerves: Vec::new(),
                nerve_lines: Vec::new(),
                core: None,
            },
        }
    }

    /// The figure's name.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// The names of its nerves, in order.
    pub fn nerve_names(&self) -> impl Iterator<Item = &str> {
        self.nerves.iter().map(|nerve| nerve.name.as_str())
    }

    /// How many line segments it draws (skin, bone, extra, brain and nerves).
    pub fn segment_count(&self) -> usize {
        self.segments.len()
            + self.brain.len()
            + self.nerve_lines.len()
            + self
                .nerves
                .iter()
                .map(|nerve| nerve.points.len().saturating_sub(1))
                .sum::<usize>()
    }

    /// The lowest and highest corners of everything it draws.
    pub(crate) fn bounds(&self) -> (Vec3, Vec3) {
        let mut low = Vec3::splat(f32::INFINITY);
        let mut high = Vec3::splat(f32::NEG_INFINITY);
        let mut grow = |point: Vec3| {
            low = low.min(point);
            high = high.max(point);
        };
        for segment in &self.segments {
            grow(segment.a);
            grow(segment.b);
        }
        for (a, b) in self.brain.iter().chain(&self.nerve_lines) {
            grow(*a);
            grow(*b);
        }
        for nerve in &self.nerves {
            nerve.points.iter().copied().for_each(&mut grow);
        }
        if let Some(core) = self.core {
            grow(core.centre());
        }
        (low, high)
    }

    /// Applies `map` to every point, keeping nerve lengths right.
    fn map_points(&mut self, map: impl Fn(Vec3) -> Vec3) {
        for segment in &mut self.segments {
            segment.a = map(segment.a);
            segment.b = map(segment.b);
        }
        for (a, b) in self.brain.iter_mut().chain(&mut self.nerve_lines) {
            *a = map(*a);
            *b = map(*b);
        }
        for nerve in &mut self.nerves {
            let points = nerve.points.iter().copied().map(&map).collect();
            *nerve = NervePath::new(std::mem::take(&mut nerve.name), points);
        }
        self.core = self.core.map(|core| core.map(&map));
    }
}

/// Collects a figure's lines; see [`Figure::builder`].
#[derive(Clone, Debug)]
pub struct FigureBuilder {
    figure: Figure,
}

impl FigureBuilder {
    fn push(&mut self, a: Vec3, b: Vec3, tissue: Tissue) -> &mut Self {
        self.figure.segments.push(Segment { a, b, tissue });
        self
    }

    /// A skin segment.
    pub fn skin(&mut self, a: Vec3, b: Vec3) -> &mut Self {
        self.push(a, b, Tissue::Skin)
    }

    /// A bone segment.
    pub fn bone(&mut self, a: Vec3, b: Vec3) -> &mut Self {
        self.push(a, b, Tissue::Bone)
    }

    /// A segment on the extra layer (muscles, organs).
    pub fn extra(&mut self, a: Vec3, b: Vec3) -> &mut Self {
        self.push(a, b, Tissue::Extra)
    }

    /// A segment of the brain, drawn with the nerves.
    pub fn brain(&mut self, a: Vec3, b: Vec3) -> &mut Self {
        self.figure.brain.push((a, b));
        self
    }

    /// A nerve line that is drawn but carries no pulses (a twig of a
    /// branching nerve tree).
    pub fn nerve_line(&mut self, a: Vec3, b: Vec3) -> &mut Self {
        self.figure.nerve_lines.push((a, b));
        self
    }

    /// A nerve from the brain outward. Paths with fewer than two points are
    /// dropped, since a pulse can't travel them.
    pub fn nerve(&mut self, name: impl Into<String>, points: Vec<Vec3>) -> &mut Self {
        if points.len() >= 2 {
            self.figure.nerves.push(NervePath::new(name.into(), points));
        }
        self
    }

    /// What beats in the chest.
    pub fn core(&mut self, core: Core) -> &mut Self {
        self.figure.core = Some(core);
        self
    }

    /// The figure as authored, already in figure units.
    pub fn build(&mut self) -> Figure {
        self.figure.clone()
    }

    /// The figure scaled to 2.0 tall, feet at `y = -1`, and centred across
    /// and front to back on `pelvis` (in the authored coordinates). Use it
    /// for figures whose source has other units, such as downloaded meshes.
    pub fn build_normalised(&mut self, pelvis: Vec3) -> Figure {
        let mut figure = self.figure.clone();
        let (low, high) = figure.bounds();
        let height = high.y - low.y;
        if !height.is_finite() || height <= 0.0 {
            return figure;
        }

        let scale = 2.0 / height;
        let origin = Vec3::new(pelvis.x, low.y, pelvis.z);
        figure.map_points(|point| {
            let scaled = (point - origin) * scale;
            Vec3::new(scaled.x, scaled.y - 1.0, scaled.z).clamp(Vec3::splat(-1.0), Vec3::splat(1.0))
        });
        figure
    }
}

/// Every built-in figure, in viewer order. The first is the default.
pub fn catalog() -> Vec<Figure> {
    #[cfg_attr(not(feature = "demo-assets"), expect(unused_mut, reason = "only assets append"))]
    let mut figures = vec![crate::model::mesh_man()];
    #[cfg(feature = "demo-assets")]
    figures.extend(crate::assets::figures());
    figures
}
