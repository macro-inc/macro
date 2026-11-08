//! A drawing surface in device pixels: a clip stack and transparency groups
//! (each drawn into its own layer and composited with its opacity, blend
//! mode, and soft mask).

use tiny_skia::{
    BlendMode, FillRule, FilterQuality, Mask, Paint, Path, Pixmap, PixmapPaint, PixmapRef, Stroke,
    Transform,
};

/// How a group's layer goes onto what is below it.
pub struct Group {
    /// Opacity.
    pub opacity: f32,
    /// Blend mode.
    pub blend: BlendMode,
    /// A soft mask over the group.
    pub mask: Option<Mask>,
}

struct Layer {
    pixmap: Pixmap,
    /// The clip in effect (`None`: nothing clipped).
    clip: Option<Mask>,
    /// Clips to return to.
    saved: Vec<Option<Mask>>,
    /// How the layer is composited (`None` for the bottom layer).
    group: Option<Group>,
}

/// A drawing surface.
pub struct Canvas {
    width: u32,
    height: u32,
    layers: Vec<Layer>,
}

impl Canvas {
    /// A transparent surface (`None` for a zero size).
    pub fn new(width: u32, height: u32) -> Option<Canvas> {
        Some(Canvas {
            width,
            height,
            layers: vec![Layer {
                pixmap: Pixmap::new(width, height)?,
                clip: None,
                saved: Vec::new(),
                group: None,
            }],
        })
    }

    /// Width in pixels.
    pub fn width(&self) -> u32 {
        self.width
    }

    /// Height in pixels.
    pub fn height(&self) -> u32 {
        self.height
    }

    fn top(&mut self) -> &mut Layer {
        self.layers.last_mut().expect("the bottom layer stays")
    }

    /// The clip in effect.
    pub fn clip(&self) -> Option<&Mask> {
        self.layers.last().and_then(|l| l.clip.as_ref())
    }

    /// Whether everything is clipped away.
    pub fn clipped_out(&self) -> bool {
        self.clip()
            .is_some_and(|m| m.data().iter().all(|&v| v == 0))
    }

    /// Clips to a path (device pixels) until the matching
    /// [`Canvas::pop_clip`]; `None` clips everything.
    pub fn push_clip(&mut self, path: Option<&Path>, rule: FillRule) {
        let (w, h) = (self.width, self.height);
        let top = self.top();
        let current = top.clip.clone();
        top.saved.push(current.clone());
        let next = match path {
            None => Mask::new(w, h),
            Some(path) => match current {
                Some(mut m) => {
                    m.intersect_path(path, rule, true, Transform::identity());
                    Some(m)
                }
                None => Mask::new(w, h).map(|mut m| {
                    m.fill_path(path, rule, true, Transform::identity());
                    m
                }),
            },
        };
        top.clip = next;
    }

    /// Restores the clip before the last [`Canvas::push_clip`].
    pub fn pop_clip(&mut self) {
        let top = self.top();
        if let Some(c) = top.saved.pop() {
            top.clip = c;
        }
    }

    /// Fills a path given in device pixels.
    pub fn fill_path(&mut self, path: &Path, paint: &Paint<'_>, rule: FillRule) {
        let top = self.top();
        top.pixmap
            .fill_path(path, paint, rule, Transform::identity(), top.clip.as_ref());
    }

    /// Fills a path with a transform to device pixels.
    pub fn fill_path_transformed(
        &mut self,
        path: &Path,
        paint: &Paint<'_>,
        rule: FillRule,
        transform: Transform,
    ) {
        let top = self.top();
        top.pixmap
            .fill_path(path, paint, rule, transform, top.clip.as_ref());
    }

    /// Strokes a path with a transform to device pixels (the stroke is
    /// transformed too).
    pub fn stroke_path(
        &mut self,
        path: &Path,
        paint: &Paint<'_>,
        stroke: &Stroke,
        transform: Transform,
    ) {
        let top = self.top();
        top.pixmap
            .stroke_path(path, paint, stroke, transform, top.clip.as_ref());
    }

    /// Draws a premultiplied pixmap.
    pub fn draw_pixmap(
        &mut self,
        pixmap: PixmapRef<'_>,
        transform: Transform,
        opacity: f32,
        blend: BlendMode,
        quality: FilterQuality,
    ) {
        let top = self.top();
        let paint = PixmapPaint {
            opacity,
            blend_mode: blend,
            quality,
        };
        top.pixmap
            .draw_pixmap(0, 0, pixmap, &paint, transform, top.clip.as_ref());
    }

    /// Runs `f` on the top layer's pixels and the clip in effect (for
    /// painting that is not a path fill, such as shadings).
    pub fn with_target(&mut self, f: impl FnOnce(&mut tiny_skia::PixmapMut<'_>, Option<&Mask>)) {
        let top = self.top();
        f(&mut top.pixmap.as_mut(), top.clip.as_ref());
    }

    /// Starts a group: what is drawn until [`Canvas::pop_group`] goes into
    /// a layer of its own.
    pub fn push_group(&mut self, group: Group) {
        let Some(pixmap) = Pixmap::new(self.width, self.height) else {
            return;
        };
        self.layers.push(Layer {
            pixmap,
            clip: None,
            saved: Vec::new(),
            group: Some(group),
        });
    }

    /// Ends a group: its layer goes onto the one below.
    pub fn pop_group(&mut self) {
        if self.layers.len() < 2 {
            return;
        }
        let mut layer = self.layers.pop().expect("checked above");
        let Some(group) = layer.group.take() else {
            return;
        };
        if let Some(mask) = &group.mask {
            layer.pixmap.apply_mask(mask);
        }
        let top = self.top();
        let paint = PixmapPaint {
            opacity: group.opacity,
            blend_mode: group.blend,
            quality: FilterQuality::Nearest,
        };
        top.pixmap.draw_pixmap(
            0,
            0,
            layer.pixmap.as_ref(),
            &paint,
            Transform::identity(),
            top.clip.as_ref(),
        );
    }

    /// Groups started and not ended.
    pub fn group_depth(&self) -> usize {
        self.layers.len() - 1
    }

    /// The finished pixels (groups left open are closed).
    pub fn finish(mut self) -> Pixmap {
        while self.layers.len() > 1 {
            self.pop_group();
        }
        self.layers.pop().expect("the bottom layer").pixmap
    }

    /// The top layer's pixels so far.
    pub fn pixmap(&self) -> &Pixmap {
        &self.layers.last().expect("the bottom layer").pixmap
    }
}

/// Straight RGBA from a premultiplied pixmap.
pub fn unpremultiply(pixmap: &Pixmap) -> Vec<u8> {
    let mut out = Vec::with_capacity(pixmap.data().len());
    for p in pixmap.pixels() {
        let c = p.demultiply();
        out.extend_from_slice(&[c.red(), c.green(), c.blue(), c.alpha()]);
    }
    out
}

/// A premultiplied pixmap from straight RGBA.
pub fn premultiplied(width: u32, height: u32, rgba: &[u8]) -> Option<Pixmap> {
    let mut pixmap = Pixmap::new(width, height)?;
    for (dst, src) in pixmap.pixels_mut().iter_mut().zip(rgba.chunks_exact(4)) {
        *dst = tiny_skia::ColorU8::from_rgba(src[0], src[1], src[2], src[3]).premultiply();
    }
    Some(pixmap)
}
