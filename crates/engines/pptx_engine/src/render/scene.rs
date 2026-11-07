//! A backend-independent display list, in slide points.

use crate::model::color::Rgba;
use crate::path::{Affine, Path, Point};
use std::sync::Arc;

/// A premultiplied RGBA8 image.
#[derive(Clone, PartialEq, Eq)]
pub struct Raster {
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// Premultiplied RGBA, row-major.
    pub pixels: Vec<u8>,
}

impl std::fmt::Debug for Raster {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Raster({}x{})", self.width, self.height)
    }
}

impl Raster {
    /// A transparent image.
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            pixels: vec![0; width as usize * height as usize * 4],
        }
    }

    /// Straight-alpha RGBA (what canvas `ImageData` expects).
    pub fn to_straight_rgba(&self) -> Vec<u8> {
        let mut out = self.pixels.clone();
        for px in out.chunks_exact_mut(4) {
            let a = px[3];
            if a != 0 && a != 255 {
                for c in &mut px[..3] {
                    *c = ((u32::from(*c) * 255 + u32::from(a) / 2) / u32::from(a)).min(255) as u8;
                }
            }
        }
        out
    }

    /// Encodes the image as PNG.
    pub fn to_png(&self) -> Vec<u8> {
        let mut out = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut out, self.width, self.height);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            enc.set_compression(png::Compression::Fast);
            if let Ok(mut w) = enc.write_header() {
                let _ = w.write_image_data(&self.to_straight_rgba());
            }
        }
        out
    }
}

/// A color stop.
pub type Stop = (f32, Rgba);

/// How an area is painted.
#[derive(Clone, Debug)]
pub enum Paint {
    /// A solid color.
    Solid(Rgba),
    /// A linear gradient between two points (scene coordinates after `transform`).
    Linear {
        /// Start point (gradient space).
        start: Point,
        /// End point (gradient space).
        end: Point,
        /// Stops.
        stops: Vec<Stop>,
        /// Gradient space → scene.
        transform: Affine,
    },
    /// A radial gradient on the unit circle mapped by `transform`.
    Radial {
        /// Stops from the center outwards.
        stops: Vec<Stop>,
        /// Unit circle → scene (an ellipse in general).
        transform: Affine,
    },
    /// An image (pixel space → scene via `transform`).
    Image {
        /// The image.
        image: Arc<Raster>,
        /// Pixel space → scene.
        transform: Affine,
        /// Repeat (tile) instead of clamping to transparent edges.
        repeat: bool,
        /// Overall opacity.
        opacity: f32,
    },
}

/// Stroke cap.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LineCap {
    /// Butt.
    Butt,
    /// Round.
    Round,
    /// Square.
    Square,
}

/// Stroke join.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LineJoin {
    /// Miter.
    Miter,
    /// Round.
    Round,
    /// Bevel.
    Bevel,
}

/// Stroke parameters in scene units.
#[derive(Clone, Debug)]
pub struct Stroke {
    /// Width (0 = hairline).
    pub width: f32,
    /// Cap.
    pub cap: LineCap,
    /// Join.
    pub join: LineJoin,
    /// Miter limit.
    pub miter_limit: f32,
    /// Dash array (absolute lengths).
    pub dash: Option<Vec<f32>>,
}

/// A layer effect applied to a group's rendered pixels.
#[derive(Clone, Debug)]
pub enum Effect {
    /// Drop shadow under the layer.
    OuterShadow {
        /// Color.
        color: Rgba,
        /// Blur radius (points).
        blur: f32,
        /// Offset (points).
        offset: Point,
        /// Extra scale/skew of the shadow about `origin`.
        transform: Affine,
    },
    /// Shadow inside the layer's opaque area.
    InnerShadow {
        /// Color.
        color: Rgba,
        /// Blur radius (points).
        blur: f32,
        /// Offset (points).
        offset: Point,
    },
    /// Colored halo around the layer.
    Glow {
        /// Color.
        color: Rgba,
        /// Radius (points).
        radius: f32,
    },
    /// Feathered edges.
    SoftEdge {
        /// Radius (points).
        radius: f32,
    },
    /// A mirrored, fading copy below the layer.
    Reflection {
        /// Axis y (points) the copy is mirrored about.
        axis: f32,
        /// Gap below the axis (points).
        dist: f32,
        /// Alpha at the start of the fade.
        start_alpha: f32,
        /// Alpha at the end of the fade.
        end_alpha: f32,
        /// Fade length as a fraction of `height`.
        end_pos: f32,
        /// Height of the mirrored content (points).
        height: f32,
        /// Blur radius (points).
        blur: f32,
    },
}

/// A display-list node.
#[derive(Clone, Debug)]
pub enum Node {
    /// Fill a path.
    Fill {
        /// The path (scene coordinates).
        path: Path,
        /// Paint.
        paint: Paint,
        /// Even-odd instead of non-zero winding.
        even_odd: bool,
    },
    /// Stroke a path.
    Stroke {
        /// The path (scene coordinates).
        path: Path,
        /// Paint.
        paint: Paint,
        /// Stroke parameters.
        stroke: Stroke,
    },
    /// A group composited as a layer when it has opacity, a clip, or effects.
    Group(Box<Group>),
}

/// A group of nodes.
#[derive(Clone, Debug, Default)]
pub struct Group {
    /// Children in paint order.
    pub children: Vec<Node>,
    /// Layer opacity.
    pub opacity: f32,
    /// Clip path (scene coordinates).
    pub clip: Option<Path>,
    /// Layer effects. Soft edges and inner shadows change the content;
    /// outer shadows and glows are cast by it and drawn beneath it;
    /// reflections mirror the result.
    pub effects: Vec<Effect>,
}

impl Group {
    /// A plain group.
    pub fn new(children: Vec<Node>) -> Self {
        Self {
            children,
            opacity: 1.0,
            clip: None,
            effects: Vec::new(),
        }
    }

    /// Wraps into a node.
    pub fn into_node(self) -> Node {
        Node::Group(Box::new(self))
    }
}

impl Paint {
    /// The paint as seen through `t` (applied after the paint's own transform).
    pub fn transformed(&self, t: &Affine) -> Paint {
        match self {
            Paint::Solid(c) => Paint::Solid(*c),
            Paint::Linear {
                start,
                end,
                stops,
                transform,
            } => Paint::Linear {
                start: *start,
                end: *end,
                stops: stops.clone(),
                transform: t.pre_concat(transform),
            },
            Paint::Radial { stops, transform } => Paint::Radial {
                stops: stops.clone(),
                transform: t.pre_concat(transform),
            },
            Paint::Image {
                image,
                transform,
                repeat,
                opacity,
            } => Paint::Image {
                image: Arc::clone(image),
                transform: t.pre_concat(transform),
                repeat: *repeat,
                opacity: *opacity,
            },
        }
    }
}

impl Node {
    /// The node mapped through `t` (paths, paints, stroke widths, clips, effects).
    pub fn transformed(&self, t: &Affine) -> Node {
        let k = t.mean_scale() as f32;
        match self {
            Node::Fill {
                path,
                paint,
                even_odd,
            } => Node::Fill {
                path: path.transform(t),
                paint: paint.transformed(t),
                even_odd: *even_odd,
            },
            Node::Stroke {
                path,
                paint,
                stroke,
            } => Node::Stroke {
                path: path.transform(t),
                paint: paint.transformed(t),
                stroke: Stroke {
                    width: stroke.width * k,
                    dash: stroke
                        .dash
                        .as_ref()
                        .map(|d| d.iter().map(|v| v * k).collect()),
                    ..stroke.clone()
                },
            },
            Node::Group(g) => Group {
                children: g.children.iter().map(|c| c.transformed(t)).collect(),
                opacity: g.opacity,
                clip: g.clip.as_ref().map(|c| c.transform(t)),
                effects: g
                    .effects
                    .iter()
                    .map(|e| match e {
                        Effect::OuterShadow {
                            color,
                            blur,
                            offset,
                            transform,
                        } => Effect::OuterShadow {
                            color: *color,
                            blur: blur * k,
                            offset: Point::new(offset.x * k, offset.y * k),
                            transform: *transform,
                        },
                        Effect::InnerShadow {
                            color,
                            blur,
                            offset,
                        } => Effect::InnerShadow {
                            color: *color,
                            blur: blur * k,
                            offset: Point::new(offset.x * k, offset.y * k),
                        },
                        Effect::Glow { color, radius } => Effect::Glow {
                            color: *color,
                            radius: radius * k,
                        },
                        Effect::SoftEdge { radius } => Effect::SoftEdge { radius: radius * k },
                        other => other.clone(),
                    })
                    .collect(),
            }
            .into_node(),
        }
    }
}
