import { choices, type Look, type PresetId, presets } from './presets';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function swatch(
  options: readonly (readonly [string, string, string])[],
  value: string
) {
  return options.find(([id]) => id === value)?.[2] ?? '#2e2017';
}

// Geometry and overlays operate on the original 96 × 120 scan coordinates.
export function portraitFilter(L: Look, preset: PresetId) {
  const baseTone = presets[presets[preset].base].look.tone;
  const toneDelta = L.tone - baseTone;
  const underHue = { cool: -10, neutral: 0, warm: 9, olive: 14 }[L.under] || 0;
  const genderBright =
    L.gender === 'feminine' ? 0.03 : L.gender === 'masculine' ? -0.02 : 0;
  const genderContrast =
    L.gender === 'masculine' ? 0.06 : L.gender === 'feminine' ? -0.04 : 0;
  const bright = clamp(0.96 - toneDelta * 0.44 + genderBright, 0.68, 1.3);
  const sat = clamp(
    1.04 +
      L.flush * 0.24 +
      (L.eyeBright - 1) * 0.14 +
      (L.under === 'olive' ? -0.05 : 0),
    0.78,
    1.44
  );
  const baseContrast =
    L.light === 'split'
      ? 1.32
      : L.light === 'rembrandt'
        ? 1.24
        : L.light === 'rim'
          ? 1.2
          : 1.18;
  const ageContrast = (L.ageTexture || 0) * 0.1;
  const contrast = clamp(
    baseContrast + genderContrast + ageContrast,
    1.14,
    1.38
  );
  return `brightness(${bright}) saturate(${sat}) hue-rotate(${underHue}deg) contrast(${contrast})`;
}

export function portraitTransform(L: Look, preset: PresetId) {
  const pr = presets[preset];
  const base = presets[pr.base].look;
  const gX =
    L.gender === 'masculine' ? 0.038 : L.gender === 'feminine' ? -0.04 : 0;
  const gY =
    L.gender === 'masculine' ? 0.016 : L.gender === 'feminine' ? -0.014 : 0;
  const dir = pr.mirror ? -1 : 1;
  const sx = (
    (1 + (L.faceWidth - base.faceWidth * 0.5) * 0.09 + gX) *
    dir
  ).toFixed(3);
  const sy = (1 + (L.jaw - base.jaw * 0.5) * 0.06 + gY).toFixed(3);
  const cam = L.framing === 'close' ? 1.3 : L.framing === 'bust' ? 1.04 : 1.18;
  const ty =
    L.framing === 'close' ? '4%' : L.framing === 'bust' ? '0.5%' : '2.5%';
  return `scale(${cam}) translateY(${ty}) scaleX(${sx}) scaleY(${sy})`;
}

export function portraitLighting(l: Look['light']) {
  const vig =
    'radial-gradient(ellipse 76% 78% at 50% 46%, rgba(0, 0, 0, 0) 58%, #000000 98%)';
  if (l === 'rembrandt') {
    return `radial-gradient(ellipse 62% 66% at 26% 28%, rgba(238, 178, 102, 0.28), rgba(0, 0, 0, 0.0) 54%), linear-gradient(115deg, rgba(255, 206, 138, 0.06) 0%, rgba(0, 0, 0, 0.12) 44%, rgba(0, 0, 0, 0.78) 92%), ${vig}`;
  }
  if (l === 'split') {
    return `linear-gradient(96deg, rgba(245, 212, 168, 0.14) 0%, rgba(0, 0, 0, 0) 42%, rgba(0, 0, 0, 0.84) 76%, #000000 100%), ${vig}`;
  }
  if (l === 'rim') {
    return `radial-gradient(ellipse 68% 72% at 50% 44%, rgba(0, 0, 0, 0.24) 40%, rgba(226, 166, 58, 0.26) 86%, rgba(0, 0, 0, 0.9) 100%), ${vig}`;
  }
  return `radial-gradient(ellipse 68% 72% at 32% 30%, rgba(235, 192, 134, 0.14), rgba(0, 0, 0, 0) 56%), linear-gradient(108deg, rgba(255, 224, 180, 0.05) 0%, rgba(0, 0, 0, 0) 42%, rgba(0, 0, 0, 0.62) 88%, rgba(0, 0, 0, 0.86) 100%), ${vig}`;
}

export function updatePortraitOverlay(
  root: Element,
  L: Look,
  preset: PresetId
) {
  const base = presets[presets[preset].base].look;
  const irisHex = swatch(choices.iris, L.iris);
  const hairHex = swatch(choices.hairColor, L.hairColor);
  const clothHex = swatch(choices.cloth, L.cloth);
  const layer = (id: string) => root.querySelector(`#${id}`);

  // 1. Independent Gender contour layer
  const gMasc = layer('ov-gender-masc');
  const gFem = layer('ov-gender-fem');
  if (gMasc && gFem) {
    gMasc.setAttribute('opacity', L.gender === 'masculine' ? '0.78' : '0');
    gFem.setAttribute('opacity', L.gender === 'feminine' ? '0.88' : '0');
  }

  // 2. Cheekbones
  const cheeks = layer('ov-cheeks');
  const chHi = layer('ov-cheek-hi');
  const chLo = layer('ov-cheek-lo');
  if (cheeks && chHi && chLo) {
    if (L.cheeks === 'high') {
      cheeks.setAttribute('opacity', '0.9');
      chHi.setAttribute('opacity', '0.42');
      chLo.setAttribute('opacity', '0.52');
    } else if (L.cheeks === 'soft') {
      cheeks.setAttribute('opacity', '0.45');
      chHi.setAttribute('opacity', '0.28');
      chLo.setAttribute('opacity', '0');
    } else {
      cheeks.setAttribute('opacity', '0');
    }
  }

  // 3. Independent Nose sculpt (Bridge width, Nose length, Tip shape)
  const nose = layer('ov-nose');
  const nHi = layer('ov-nose-hi');
  const nSh = layer('ov-nose-sh');
  const nTip = layer('ov-nose-tip');
  if (nose && nHi && nSh && nTip) {
    const dy = +(L.noseLen * 3.0).toFixed(1);
    const bw =
      L.noseBridge === 'narrow' ? -1.4 : L.noseBridge === 'broad' ? 1.8 : 0;
    const yEnd = (72 + dy).toFixed(1);
    const yTip = (73.5 + dy).toFixed(1);
    const xL = (40 - bw).toFixed(1);
    const xR = (47.5 + bw).toFixed(1);
    const tipPaths = {
      soft: `M${(39.5 - bw).toFixed(1)} ${yTip} Q43.8 ${(75.8 + dy).toFixed(1)} ${(48 + bw).toFixed(1)} ${yTip}`,
      defined: `M${(39 - bw).toFixed(1)} ${yTip} Q43.8 ${(77.4 + dy).toFixed(1)} ${(48.8 + bw).toFixed(1)} ${yTip}`,
      aquiline: `M${(40 - bw).toFixed(1)} ${(71.5 + dy).toFixed(1)} Q43.2 ${(78.4 + dy).toFixed(1)} ${(48 + bw).toFixed(1)} ${(73.5 + dy).toFixed(1)}`,
      snub: `M${(39.2 - bw).toFixed(1)} ${(72.5 + dy).toFixed(1)} Q43.8 ${(74.2 + dy).toFixed(1)} ${(48.5 + bw).toFixed(1)} ${(72.5 + dy).toFixed(1)}`,
    };
    const tipW =
      L.noseTip === 'aquiline'
        ? '2.0'
        : L.noseTip === 'defined'
          ? '1.6'
          : L.noseTip === 'snub'
            ? '1.2'
            : '1.0';
    const activeNose =
      L.noseBridge !== 'balanced' ||
      Math.abs(L.noseLen) > 0.05 ||
      L.noseTip !== 'defined';
    nose.setAttribute('opacity', activeNose ? '0.86' : '0.18');
    nHi.setAttribute(
      'd',
      `M${(43.2 - bw * 0.4).toFixed(1)} 55.5 L${(42.6 - bw * 0.4).toFixed(1)} ${yEnd} L${(45.2 + bw * 0.4).toFixed(1)} ${yEnd} L${(45.6 + bw * 0.4).toFixed(1)} 55.5 Z`
    );
    nSh.setAttribute(
      'd',
      `M${xL} 56.5 L${(38.5 - bw).toFixed(1)} ${yTip} Q43.8 ${(76.5 + dy).toFixed(1)} ${(49.2 + bw).toFixed(1)} ${yTip} L${xR} 56.5 L${(46 + bw * 0.6).toFixed(1)} ${yEnd} Q43.8 ${(74.5 + dy).toFixed(1)} ${(40.6 - bw * 0.6).toFixed(1)} ${yEnd} Z`
    );
    nTip.setAttribute('d', tipPaths[L.noseTip] || tipPaths.defined);
    nTip.setAttribute('stroke-width', tipW);
  }

  // 4. Undertone, Flush & Freckles
  const underEl = layer('ov-under-wash');
  if (underEl) {
    const uCfg = {
      cool: { fill: '#5a8fd4', op: '0.24' },
      neutral: { fill: '#d88a4a', op: '0' },
      warm: { fill: '#e38c42', op: '0.24' },
      olive: { fill: '#8f9a4b', op: '0.26' },
    }[L.under] || { fill: '#d88a4a', op: '0' };
    underEl.setAttribute('fill', uCfg.fill);
    underEl.setAttribute('opacity', uCfg.op);
  }
  const flushEl = layer('ov-flush');
  if (flushEl) flushEl.setAttribute('opacity', (L.flush * 0.86).toFixed(2));
  const fl = layer('ov-freckles-light');
  const fm = layer('ov-freckles-med');
  const fd = layer('ov-freckles-dense');
  if (fl && fm && fd) {
    fl.setAttribute('opacity', L.freckles === 'none' ? '0' : '0.72');
    fm.setAttribute(
      'opacity',
      L.freckles === 'medium' || L.freckles === 'dense' ? '0.72' : '0'
    );
    fd.setAttribute('opacity', L.freckles === 'dense' ? '0.78' : '0');
  }

  // 5. Jawline shadow
  const jawEl = layer('ov-jaw');
  if (jawEl)
    jawEl.setAttribute(
      'opacity',
      Math.max(0, Math.min(0.65, 0.06 + L.jaw * 0.36)).toFixed(2)
    );

  // 5b. Age & Skin Texture layer
  const ageEl = layer('ov-age-texture');
  if (ageEl) {
    const ageVal = clamp(L.ageTexture || 0, 0, 1);
    ageEl.setAttribute('opacity', (ageVal * 0.92).toFixed(2));
  }

  // 5c. Expression layer (mouth curve + subtle eye/cheek lift)
  const exprGroup = layer('ov-expression');
  const mouthLine = layer('ov-mouth-line');
  const mouthHi = layer('ov-mouth-hi');
  const exprEyes = layer('ov-expr-eyes');
  if (exprGroup && mouthLine && mouthHi && exprEyes) {
    const eCfg = {
      composed: {
        op: 0.14,
        line: 'M36 85 Q43.8 85.4 51.6 85',
        hi: 'M38 86.8 Q43.8 88.0 49.6 86.8',
        eyeOp: 0,
      },
      warm: {
        op: 0.84,
        line: 'M34.5 83.6 Q43.8 88.8 53.1 83.6',
        hi: 'M37 86.2 Q43.8 90.2 50.6 86.2',
        eyeOp: 0.42,
      },
      focused: {
        op: 0.72,
        line: 'M36.5 85.6 Q43.8 84.5 51.1 85.6',
        hi: 'M39 87.2 Q43.8 86.8 48.6 87.2',
        eyeOp: 0.25,
      },
      smirk: {
        op: 0.82,
        line: 'M36.2 85.6 Q44.2 86.8 53.4 82.8',
        hi: 'M38.5 87.2 Q44.8 88.6 51.2 85.6',
        eyeOp: 0.22,
      },
    }[L.expression] || {
      op: 0.14,
      line: 'M36 85 Q43.8 85.4 51.6 85',
      hi: 'M38 86.8 Q43.8 88.0 49.6 86.8',
      eyeOp: 0,
    };
    exprGroup.setAttribute('opacity', String(eCfg.op));
    mouthLine.setAttribute('d', eCfg.line);
    mouthHi.setAttribute('d', eCfg.hi);
    exprEyes.setAttribute('opacity', String(eCfg.eyeOp));
  }

  // 6. Eyes (Iris colour, Eye clarity, Eye tilt) & Brows (Shape, Spacing, Arch)
  const eyeTiltDeg = clamp((L.eyeTilt || 0) * 11, -12, 12);
  const eyeL = layer('ov-eye-l');
  const eyeR = layer('ov-eye-r');
  if (eyeL && eyeR) {
    // Positive eyeTilt lifts outer corners symmetrically (left rotates CCW, right rotates CW)
    eyeL.setAttribute(
      'transform',
      `rotate(${(-eyeTiltDeg).toFixed(1)} 30.5 57.2)`
    );
    eyeR.setAttribute(
      'transform',
      `rotate(${(eyeTiltDeg).toFixed(1)} 56.2 57.2)`
    );
  }
  const lidOp = Math.max(
    0.22,
    Math.min(0.76, 0.22 + Math.abs(L.eyeTilt || 0) * 0.54)
  ).toFixed(2);
  const lidL = layer('ov-lid-l');
  const lidR = layer('ov-lid-r');
  if (lidL && lidR) {
    lidL.setAttribute('opacity', lidOp);
    lidR.setAttribute('opacity', lidOp);
  }
  const irisOp = (0.58 + (L.eyeBright - 0.75) * 0.55).toFixed(2);
  for (const id of ['ov-iris-l', 'ov-iris-r']) {
    const el = layer(id);
    if (el) {
      el.setAttribute('fill', irisHex);
      el.setAttribute('opacity', irisOp);
    }
  }
  const glintOp = Math.max(
    0.15,
    Math.min(0.95, (L.eyeBright - 0.55) * 0.95)
  ).toFixed(2);
  for (const id of ['ov-glint-l', 'ov-glint-r']) {
    const el = layer(id);
    if (el) el.setAttribute('opacity', glintOp);
  }

  const brows = layer('ov-brows');
  const bl = layer('ov-brow-l');
  const br = layer('ov-brow-r');
  if (brows && bl && br) {
    brows.setAttribute('stroke', hairHex);
    const sp = clamp(L.browSpacing || 0, -1, 1) * 2.6; // outward shift in SVG units
    const ar = clamp(L.browArch || 0, -1, 1) * 3.4; // upward control-point lift
    const exprBrow =
      L.expression === 'focused' ? 1.1 : L.expression === 'warm' ? -0.6 : 0;
    const baseCfg = {
      straight: {
        op: 0.62,
        w: 2.3,
        yOut: 50.2,
        yMid: 50.2,
        yIn: 50.4,
        sharp: false,
      },
      natural: {
        op: 0.34,
        w: 2.0,
        yOut: 50.8,
        yMid: 48.8,
        yIn: 50.6,
        sharp: false,
      },
      arched: {
        op: 0.6,
        w: 2.0,
        yOut: 51.6,
        yMid: 45.8,
        yIn: 50.2,
        sharp: false,
      },
      thick: {
        op: 0.8,
        w: 3.7,
        yOut: 50.5,
        yMid: 48.6,
        yIn: 50.6,
        sharp: false,
      },
      sharp: {
        op: 0.68,
        w: 2.3,
        yOut: 51.4,
        yMid: 46.8,
        yIn: 50.6,
        sharp: true,
      },
      soft: {
        op: 0.42,
        w: 1.6,
        yOut: 50.6,
        yMid: 48.2,
        yIn: 50.2,
        sharp: false,
      },
    }[L.brow] || {
      op: 0.34,
      w: 2.0,
      yOut: 50.8,
      yMid: 48.8,
      yIn: 50.6,
      sharp: false,
    };

    const activeCustomBrow =
      Math.abs(L.browSpacing || 0) > 0.05 ||
      Math.abs(L.browArch || 0) > 0.05 ||
      L.expression === 'focused';
    const finalOp = Math.min(0.88, baseCfg.op + (activeCustomBrow ? 0.24 : 0));

    const lOutX = (22 - sp * 0.7).toFixed(1);
    const lMidX = (30.2 - sp * 0.85).toFixed(1);
    const lInX = (38.5 - sp).toFixed(1);
    const rInX = (47.0 + sp).toFixed(1);
    const rMidX = (56.2 + sp * 0.85).toFixed(1);
    const rOutX = (66.8 + sp * 0.7).toFixed(1);

    const yOut = (baseCfg.yOut + ar * 0.15).toFixed(1);
    const yMid = (baseCfg.yMid - ar + exprBrow * 0.4).toFixed(1);
    const yIn = (baseCfg.yIn + exprBrow).toFixed(1);

    const dL = baseCfg.sharp
      ? `M${lOutX} ${yOut} L${lMidX} ${yMid} L${lInX} ${yIn}`
      : `M${lOutX} ${yOut} Q${lMidX} ${yMid} ${lInX} ${yIn}`;
    const dR = baseCfg.sharp
      ? `M${rInX} ${yIn} L${rMidX} ${yMid} L${rOutX} ${yOut}`
      : `M${rInX} ${yIn} Q${rMidX} ${yMid} ${rOutX} ${yOut}`;

    brows.setAttribute('opacity', finalOp.toFixed(2));
    bl.setAttribute('d', dL);
    bl.setAttribute('stroke-width', String(baseCfg.w));
    br.setAttribute('d', dR);
    br.setAttribute('stroke-width', String(baseCfg.w));
  }

  // 7. Hair colour & 7 discrete Hairstyles
  const ht = layer('ov-hair-tint');
  const hs = layer('ov-hair-style');
  if (ht && hs) {
    ht.setAttribute('fill', hairHex);
    hs.setAttribute('fill', hairHex);
    ht.setAttribute(
      'opacity',
      L.hairColor !== base.hairColor ? '0.72' : '0.18'
    );
    const sameHair = L.hair === base.hair;
    const hCfg = {
      close: {
        op: sameHair ? 0.0 : 0.26,
        d: 'M22 38 C22 21 33 15 48 15 C63 15 73 21 73 38 C68 30 59 27 48 27 C37 27 27 30 22 38 Z',
      },
      buzz: {
        op: sameHair ? 0.0 : 0.42,
        d: 'M21 40 C20 22 31 14 48 14 C65 14 75 22 74 40 C69 32 60 28 48 28 C36 28 26 32 21 40 Z',
      },
      crop: {
        op: sameHair ? 0.0 : 0.5,
        d: 'M19 42 C18 19 30 11 48 11 C66 11 77 19 75 42 C70 31 60 27 48 27 C36 27 25 31 19 42 Z',
      },
      side: {
        op: sameHair ? 0.0 : 0.48,
        d: 'M18 45 C17 19 29 10 49 10 C68 10 78 21 76 46 C71 33 61 28 47 28 C35 28 24 34 18 45 Z',
      },
      swept: {
        op: sameHair ? 0.0 : 0.58,
        d: 'M17 44 C15 16 28 6 48 6 C68 6 80 16 78 44 C73 28 62 23 48 23 C33 23 22 28 17 44 Z',
      },
      waves: {
        op: sameHair ? 0.0 : 0.62,
        d: 'M14 50 C11 22 24 7 48 7 C72 7 84 22 81 50 C76 34 65 26 48 26 C31 26 19 34 14 50 Z',
      },
      long: {
        op: sameHair ? 0.0 : 0.7,
        d: 'M13 84 C11 32 21 8 48 8 C75 8 84 32 82 84 C77 82 73 74 72 48 C68 33 60 26 48 26 C35 26 26 33 23 48 C22 74 18 82 13 84 Z',
      },
    }[L.hair] || { op: 0, d: '' };
    hs.setAttribute('opacity', String(hCfg.op));
    hs.setAttribute('d', hCfg.d);
  }

  // 8. Facial hair
  const beard = layer('ov-beard');
  const beardPath = layer('ov-beard-path');
  const beardGrad = layer('ov-beard-grad');
  if (beard && beardPath && beardGrad) {
    for (const stop of beardGrad.querySelectorAll('stop'))
      stop.setAttribute('stop-color', hairHex);
    const sameBeard = L.beard === base.beard;
    const bCfg = {
      clean: {
        op: 0.0,
        d: 'M25 76 C26 91 34 100 46 101 C58 100 66 91 67 76 Z',
      },
      stubble: {
        op: sameBeard ? 0.14 : 0.32,
        d: 'M25 76 C26 91 34 100 46 101 C58 100 66 91 67 76 C63 85 56 90 46 90 C36 90 29 85 25 76 Z M35 80 Q44 77 53 80 Q44 82.5 35 80 Z',
      },
      goatee: {
        op: 0.72,
        d: 'M35 80 Q44 77 53 80 Q44 83 35 80 Z M35 89 Q44 92 53 89 L51 102 Q44 105 37 102 Z',
      },
      mustache: {
        op: 0.74,
        d: 'M33 81 Q39 76.5 44 78.5 Q49 76.5 55 81 Q49 83.2 44 81.8 Q39 83.2 33 81 Z',
      },
      short: {
        op: sameBeard ? 0.16 : 0.66,
        d: 'M24 74 C24 92 34 103 46 104 C59 103 68 92 68 74 C63 83 56 88 46 88 C36 88 29 83 24 74 Z M34 79 Q44 76 54 79 Q44 83.5 34 79 Z',
      },
      full: {
        op: sameBeard ? 0.18 : 0.9,
        d: 'M22 71 C21 94 32 108 46 109 C61 108 71 94 70 71 C64 81 56 87 46 87 C36 87 28 81 22 71 Z M33 78 Q44 74.5 55 78 Q44 84 33 78 Z',
      },
    }[L.beard] || { op: 0, d: '' };
    beard.setAttribute('opacity', String(bCfg.op));
    beardPath.setAttribute('d', bCfg.d);
  }

  // 9. Outfit
  const ob = layer('ov-outfit-body');
  const ot = layer('ov-outfit-trim');
  if (ob && ot) {
    ob.setAttribute('fill', clothHex);
    const oCfg = {
      crew: {
        body: 'M2 120 L8 109 Q26 105 34 105 Q46 114 60 105 Q70 105 88 109 L94 120 Z',
        trim: 'M33 105 Q46 115 61 105',
      },
      vneck: {
        body: 'M2 120 L8 109 Q26 105 35 105 L47 118 L59 105 Q70 105 88 109 L94 120 Z',
        trim: 'M34 105 L47 118.5 L60 105',
      },
      turtle: {
        body: 'M2 120 L8 109 Q26 105 32 103 L34 96 Q46 99 60 96 L62 103 Q70 105 88 109 L94 120 Z',
        trim: 'M34 99 Q47 102 60 99',
      },
      collar: {
        body: 'M2 120 L6 108 Q25 104 34 102 L47 115 L60 102 Q71 104 90 108 L94 120 Z',
        trim: 'M30 104 L41 116 L47 113 L53 116 L64 104',
      },
      jacket: {
        body: 'M0 120 L5 106 Q22 101 33 101 L43 120 L51 120 L61 101 Q72 101 91 106 L96 120 Z',
        trim: 'M28 102 L38 119 M66 102 L56 119',
      },
      trench: {
        body: 'M0 120 L4 105 Q20 100 31 98 L47 116 L63 98 Q74 100 92 105 L96 120 Z',
        trim: 'M27 100 L43 117 M67 100 L51 117 M12 104 L26 108 M84 104 L70 108',
      },
    }[L.outfit] || { body: '', trim: '' };
    ob.setAttribute('d', oCfg.body);
    ot.setAttribute('d', oCfg.trim);
  }

  // 10. Independent Accessories (grounded weapon-free human eyewear, earpiece, subtle accent)
  const ewEl = layer('ov-acc-eyewear');
  if (ewEl) {
    const ewMap = {
      none: '',
      rimless: `<rect x="20.5" y="52" width="19.5" height="10.5" rx="1.6" fill="rgba(186,220,255,0.12)" stroke="#cfd7e3" stroke-width="0.9"/><rect x="46.5" y="52" width="20.5" height="10.5" rx="1.6" fill="rgba(186,220,255,0.12)" stroke="#cfd7e3" stroke-width="0.9"/><line x1="40" y1="56.2" x2="46.5" y2="56.2" stroke="#cfd7e3" stroke-width="1"/><line x1="67" y1="56.2" x2="73" y2="55.5" stroke="#cfd7e3" stroke-width="0.9"/>`,
      wire: `<circle cx="30.5" cy="57.2" r="8.2" fill="rgba(226,166,58,0.06)" stroke="#c7a96b" stroke-width="1.15"/><circle cx="56.2" cy="57.2" r="8.4" fill="rgba(226,166,58,0.06)" stroke="#c7a96b" stroke-width="1.15"/><path d="M38.7 56.5 Q43.2 54.5 47.8 56.5" fill="none" stroke="#c7a96b" stroke-width="1.15"/><line x1="64.6" y1="56.5" x2="73.5" y2="55.5" stroke="#c7a96b" stroke-width="1.05"/>`,
      rect: `<rect x="19.5" y="52" width="21" height="10.5" rx="1.5" fill="rgba(220,232,248,0.10)" stroke="#8fa0b5" stroke-width="1.45"/><rect x="45.5" y="52" width="22" height="10.5" rx="1.5" fill="rgba(220,232,248,0.10)" stroke="#8fa0b5" stroke-width="1.45"/><line x1="40.5" y1="56" x2="45.5" y2="56" stroke="#8fa0b5" stroke-width="1.5"/><line x1="67.5" y1="56" x2="74" y2="55" stroke="#8fa0b5" stroke-width="1.2"/>`,
      shades: `<rect x="19.5" y="51.5" width="21" height="11.5" rx="2" fill="#090b0f" opacity="0.86" stroke="#5c6676" stroke-width="1.2"/><rect x="45.5" y="51.5" width="22" height="11.5" rx="2" fill="#090b0f" opacity="0.86" stroke="#5c6676" stroke-width="1.2"/><line x1="40.5" y1="55.5" x2="45.5" y2="55.5" stroke="#5c6676" stroke-width="1.5"/><line x1="67.5" y1="55.5" x2="74" y2="54.5" stroke="#5c6676" stroke-width="1.2"/><path d="M22 53.5 L28 53.5 L24 58 Z M48 53.5 L54 53.5 L50 58 Z" fill="#ffffff" opacity="0.16"/>`,
    };
    ewEl.innerHTML = ewMap[L.eyewear] || '';
  }

  const epEl = layer('ov-acc-earpiece');
  if (epEl) {
    const epMap = {
      none: '',
      stud: `<circle cx="70.5" cy="70.5" r="1.4" fill="#d9e0ea" stroke="#181c22" stroke-width="0.5"/>`,
      ring: `<circle cx="70.5" cy="72" r="2.6" fill="none" stroke="#e2a63a" stroke-width="1.15"/>`,
      comms: `<path d="M71.5 61 C74 63 74.5 69 72 72.5 L69 72 L70 64 Z" fill="#202630" stroke="#7d8a9d" stroke-width="0.9"/><circle cx="72" cy="67" r="1.1" fill="#e2a63a"/>`,
    };
    epEl.innerHTML = epMap[L.earpiece] || '';
  }

  const mkEl = layer('ov-acc-mark');
  if (mkEl) {
    const mkMap = {
      none: '',
      scar: `<path d="M58.5 63.5 L63.5 76" stroke="#c88d7a" stroke-width="1.4" stroke-linecap="round" opacity="0.72"/><path d="M59.2 63.5 L64.2 76" stroke="#361c16" stroke-width="0.7" stroke-linecap="round" opacity="0.55"/>`,
      mole: `<circle cx="57.5" cy="75.5" r="1.1" fill="#241610" opacity="0.88"/>`,
      'brow-scar': `<path d="M27.5 46.5 L30.5 53.5" stroke="#d8a28c" stroke-width="1.35" stroke-linecap="round" opacity="0.78"/><path d="M28.1 46.5 L31.1 53.5" stroke="#2d1812" stroke-width="0.65" stroke-linecap="round" opacity="0.55"/>`,
    };
    mkEl.innerHTML = mkMap[L.mark] || '';
  }
}
