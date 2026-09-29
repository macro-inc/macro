import type {
  ArcParams,
  PathCommand,
  PathData,
  Point3D,
} from '../types/svgTypes';

export function arcSegmentToBezier(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  cosPhi: number,
  sinPhi: number,
  startAngle: number,
  endAngle: number
): { cp1: Point3D; cp2: Point3D; end: Point3D } {
  const deltaAngle = endAngle - startAngle;

  const alpha =
    (Math.sin(deltaAngle) *
      (Math.sqrt(4 + 3 * Math.tan(deltaAngle / 2) ** 2) - 1)) /
    3;

  const cosStart = Math.cos(startAngle);
  const sinStart = Math.sin(startAngle);

  const cosEnd = Math.cos(endAngle);
  const sinEnd = Math.sin(endAngle);

  const cp1x = rx * (cosStart - alpha * sinStart);
  const cp1y = ry * (sinStart + alpha * cosStart);

  const cp2x = rx * (cosEnd + alpha * sinEnd);
  const cp2y = ry * (sinEnd - alpha * cosEnd);

  const endX = rx * cosEnd;
  const endY = ry * sinEnd;

  return {
    cp1: {
      x: cosPhi * cp1x - sinPhi * cp1y + cx,
      y: sinPhi * cp1x + cosPhi * cp1y + cy,
      z: 0,
    },
    cp2: {
      x: cosPhi * cp2x - sinPhi * cp2y + cx,
      y: sinPhi * cp2x + cosPhi * cp2y + cy,
      z: 0,
    },
    end: {
      x: cosPhi * endX - sinPhi * endY + cx,
      y: sinPhi * endX + cosPhi * endY + cy,
      z: 0,
    },
  };
}

function arcToBeziers(params: ArcParams): PathCommand[] {
  const { x1, y1, x2, y2 } = params;
  let { rx, ry, phi, largeArc, sweep } = params;

  const commands: PathCommand[] = [];

  if (x1 === x2 && y1 === y2) return commands;
  if (rx === 0 || ry === 0) {
    commands.push({ type: 'L', points: [{ x: x2, y: y2, z: 0 }] });
    return commands;
  }

  rx = Math.abs(rx);
  ry = Math.abs(ry);

  const phiRad = (phi * Math.PI) / 180;
  const cosPhi = Math.cos(phiRad);
  const sinPhi = Math.sin(phiRad);

  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;

  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const sqrtLambda = Math.sqrt(lambda);
    rx *= sqrtLambda;
    ry *= sqrtLambda;
  }

  const rxSq = rx * rx;
  const rySq = ry * ry;
  const x1pSq = x1p * x1p;
  const y1pSq = y1p * y1p;

  let sq =
    (rxSq * rySq - rxSq * y1pSq - rySq * x1pSq) / (rxSq * y1pSq + rySq * x1pSq);
  sq = Math.sqrt(Math.max(0, sq));

  if (largeArc === sweep) sq = -sq;

  const cxp = (sq * (rx * y1p)) / ry;
  const cyp = (-sq * (ry * x1p)) / rx;

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;

  const theta1 = Math.atan2(uy, ux);

  const n = Math.sqrt(ux * ux + uy * uy);
  const p = Math.sqrt(vx * vx + vy * vy);
  let dtheta = Math.acos(
    Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (n * p)))
  );

  if (ux * vy - uy * vx < 0) dtheta = -dtheta;

  if (sweep && dtheta < 0) dtheta += 2 * Math.PI;
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;

  const segments = Math.ceil(Math.abs(dtheta) / (Math.PI / 2));
  const segmentAngle = dtheta / segments;

  let currentAngle = theta1;

  for (let i = 0; i < segments; i++) {
    const startAngle = currentAngle;
    const endAngle = currentAngle + segmentAngle;

    const bezier = arcSegmentToBezier(
      cx,
      cy,
      rx,
      ry,
      cosPhi,
      sinPhi,
      startAngle,
      endAngle
    );

    commands.push({
      type: 'C',
      points: [bezier.cp1, bezier.cp2, bezier.end],
    });

    currentAngle = endAngle;
  }

  return commands;
}

function tokenizeNumbers(str: string): number[] {
  const nums: number[] = [];
  let current = '';
  let hasDecimal = false;
  let hasExponent = false;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (ch === ' ' || ch === ',' || ch === '\t' || ch === '\n' || ch === '\r') {
      if (current) {
        nums.push(Number(current));
        current = '';
        hasDecimal = false;
        hasExponent = false;
      }
      continue;
    }

    if (ch === '-' || ch === '+') {
      if (current && !current.endsWith('e') && !current.endsWith('E')) {
        nums.push(Number(current));
        current = '';
        hasDecimal = false;
        hasExponent = false;
      }
      current += ch;
      continue;
    }

    if (ch === '.') {
      if (hasDecimal || hasExponent) {
        if (current) {
          nums.push(Number(current));
        }
        current = '.';
        hasDecimal = true;
        hasExponent = false;
      } else {
        hasDecimal = true;
        current += ch;
      }
      continue;
    }

    if (ch === 'e' || ch === 'E') {
      hasExponent = true;
      hasDecimal = true;
      current += ch;
      continue;
    }

    current += ch;
  }

  if (current) {
    nums.push(Number(current));
  }

  return nums;
}

/**
 * Elevate a quadratic Bézier to a cubic Bézier
 * Q(t) with control point qcp becomes C(t) with two control points
 */
function quadraticToCubic(
  startX: number,
  startY: number,
  qcpX: number,
  qcpY: number,
  endX: number,
  endY: number
): { cp1: Point3D; cp2: Point3D; end: Point3D } {
  return {
    cp1: {
      x: startX + (2 / 3) * (qcpX - startX),
      y: startY + (2 / 3) * (qcpY - startY),
      z: 0,
    },
    cp2: {
      x: endX + (2 / 3) * (qcpX - endX),
      y: endY + (2 / 3) * (qcpY - endY),
      z: 0,
    },
    end: {
      x: endX,
      y: endY,
      z: 0,
    },
  };
}

function parsePath(d: string): PathCommand[] {
  const commands: PathCommand[] = [];

  const cmdRegex = /([MLHVACQSTZ])\s*([\d\s.\-,e+]*)/gi;
  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;
  let lastCubicCpX = 0;
  let lastCubicCpY = 0;
  let lastQuadCpX = 0;
  let lastQuadCpY = 0;
  let lastCmd = '';

  for (const match of d.matchAll(cmdRegex)) {
    const cmd = match[1];
    const type = cmd.toUpperCase();
    const isRelative = cmd === cmd.toLowerCase() && cmd !== 'z' && cmd !== 'Z';
    const argsStr = match[2].trim();
    const args = argsStr ? tokenizeNumbers(argsStr) : [];

    switch (type) {
      case 'M': {
        for (let i = 0; i < args.length; i += 2) {
          if (isRelative && i === 0) {
            currentX += args[i];
            currentY += args[i + 1];
          } else if (isRelative) {
            currentX += args[i];
            currentY += args[i + 1];
          } else {
            currentX = args[i];
            currentY = args[i + 1];
          }
          if (i === 0) {
            startX = currentX;
            startY = currentY;
            commands.push({
              type: 'M',
              points: [{ x: currentX, y: currentY, z: 0 }],
            });
          } else {
            commands.push({
              type: 'L',
              points: [{ x: currentX, y: currentY, z: 0 }],
            });
          }
        }
        lastCubicCpX = currentX;
        lastCubicCpY = currentY;
        lastQuadCpX = currentX;
        lastQuadCpY = currentY;
        break;
      }
      case 'L': {
        for (let i = 0; i < args.length; i += 2) {
          if (isRelative) {
            currentX += args[i];
            currentY += args[i + 1];
          } else {
            currentX = args[i];
            currentY = args[i + 1];
          }
          commands.push({
            type: 'L',
            points: [{ x: currentX, y: currentY, z: 0 }],
          });
        }
        lastCubicCpX = currentX;
        lastCubicCpY = currentY;
        lastQuadCpX = currentX;
        lastQuadCpY = currentY;
        break;
      }
      case 'H': {
        for (const x of args) {
          if (isRelative) {
            currentX += x;
          } else {
            currentX = x;
          }
          commands.push({
            type: 'L',
            points: [{ x: currentX, y: currentY, z: 0 }],
          });
        }
        lastCubicCpX = currentX;
        lastCubicCpY = currentY;
        lastQuadCpX = currentX;
        lastQuadCpY = currentY;
        break;
      }
      case 'V': {
        for (const y of args) {
          if (isRelative) {
            currentY += y;
          } else {
            currentY = y;
          }
          commands.push({
            type: 'L',
            points: [{ x: currentX, y: currentY, z: 0 }],
          });
        }
        lastCubicCpX = currentX;
        lastCubicCpY = currentY;
        lastQuadCpX = currentX;
        lastQuadCpY = currentY;
        break;
      }
      case 'A': {
        for (let i = 0; i < args.length; i += 7) {
          const endX = isRelative ? currentX + args[i + 5] : args[i + 5];
          const endY = isRelative ? currentY + args[i + 6] : args[i + 6];

          const beziers = arcToBeziers({
            x1: currentX,
            y1: currentY,
            rx: args[i],
            ry: args[i + 1],
            phi: args[i + 2],
            largeArc: args[i + 3] === 1,
            sweep: args[i + 4] === 1,
            x2: endX,
            y2: endY,
          });

          commands.push(...beziers);

          currentX = endX;
          currentY = endY;
        }
        lastCubicCpX = currentX;
        lastCubicCpY = currentY;
        lastQuadCpX = currentX;
        lastQuadCpY = currentY;
        break;
      }
      case 'C': {
        for (let i = 0; i < args.length; i += 6) {
          const cp1x = isRelative ? currentX + args[i] : args[i];
          const cp1y = isRelative ? currentY + args[i + 1] : args[i + 1];
          const cp2x = isRelative ? currentX + args[i + 2] : args[i + 2];
          const cp2y = isRelative ? currentY + args[i + 3] : args[i + 3];
          const x = isRelative ? currentX + args[i + 4] : args[i + 4];
          const y = isRelative ? currentY + args[i + 5] : args[i + 5];

          commands.push({
            type: 'C',
            points: [
              { x: cp1x, y: cp1y, z: 0 },
              { x: cp2x, y: cp2y, z: 0 },
              { x, y, z: 0 },
            ],
          });

          lastCubicCpX = cp2x;
          lastCubicCpY = cp2y;
          currentX = x;
          currentY = y;
        }
        lastQuadCpX = currentX;
        lastQuadCpY = currentY;
        break;
      }
      case 'S': {
        for (let i = 0; i < args.length; i += 4) {
          let cp1x: number, cp1y: number;
          if (lastCmd === 'C' || lastCmd === 'S') {
            cp1x = 2 * currentX - lastCubicCpX;
            cp1y = 2 * currentY - lastCubicCpY;
          } else {
            cp1x = currentX;
            cp1y = currentY;
          }

          const cp2x = isRelative ? currentX + args[i] : args[i];
          const cp2y = isRelative ? currentY + args[i + 1] : args[i + 1];
          const x = isRelative ? currentX + args[i + 2] : args[i + 2];
          const y = isRelative ? currentY + args[i + 3] : args[i + 3];

          commands.push({
            type: 'C',
            points: [
              { x: cp1x, y: cp1y, z: 0 },
              { x: cp2x, y: cp2y, z: 0 },
              { x, y, z: 0 },
            ],
          });

          lastCubicCpX = cp2x;
          lastCubicCpY = cp2y;
          currentX = x;
          currentY = y;
        }
        lastQuadCpX = currentX;
        lastQuadCpY = currentY;
        lastCmd = 'S';
        continue;
      }
      case 'Q': {
        for (let i = 0; i < args.length; i += 4) {
          const qcpX = isRelative ? currentX + args[i] : args[i];
          const qcpY = isRelative ? currentY + args[i + 1] : args[i + 1];
          const x = isRelative ? currentX + args[i + 2] : args[i + 2];
          const y = isRelative ? currentY + args[i + 3] : args[i + 3];

          const cubic = quadraticToCubic(currentX, currentY, qcpX, qcpY, x, y);

          commands.push({
            type: 'C',
            points: [cubic.cp1, cubic.cp2, cubic.end],
          });

          lastQuadCpX = qcpX;
          lastQuadCpY = qcpY;
          currentX = x;
          currentY = y;
        }
        lastCubicCpX = currentX;
        lastCubicCpY = currentY;
        break;
      }
      case 'T': {
        for (let i = 0; i < args.length; i += 2) {
          let qcpX: number, qcpY: number;
          if (lastCmd === 'Q' || lastCmd === 'T') {
            qcpX = 2 * currentX - lastQuadCpX;
            qcpY = 2 * currentY - lastQuadCpY;
          } else {
            qcpX = currentX;
            qcpY = currentY;
          }

          const x = isRelative ? currentX + args[i] : args[i];
          const y = isRelative ? currentY + args[i + 1] : args[i + 1];

          const cubic = quadraticToCubic(currentX, currentY, qcpX, qcpY, x, y);

          commands.push({
            type: 'C',
            points: [cubic.cp1, cubic.cp2, cubic.end],
          });

          lastQuadCpX = qcpX;
          lastQuadCpY = qcpY;
          currentX = x;
          currentY = y;
        }
        lastCubicCpX = currentX;
        lastCubicCpY = currentY;
        lastCmd = 'T';
        continue;
      }
      case 'Z': {
        commands.push({ type: 'Z', points: [] });
        currentX = startX;
        currentY = startY;
        lastCubicCpX = currentX;
        lastCubicCpY = currentY;
        lastQuadCpX = currentX;
        lastQuadCpY = currentY;
        break;
      }
    }

    lastCmd = type;
  }

  return commands;
}

export function parseSvg(svgString: string, id?: string): PathData[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const svg = doc.querySelector('svg');

  if (!svg) {
    throw new Error('No SVG element found');
  }

  const paths: PathData[] = [];

  const pathEls = id
    ? svg.querySelectorAll(`path[id="${id}"]`)
    : svg.querySelectorAll('path');

  pathEls.forEach((pathEl) => {
    const d = pathEl.getAttribute('d');
    if (!d) {
      return;
    }

    const commands = parsePath(d);

    let pointCount = 0;
    for (const cmd of commands) {
      pointCount += cmd.points.length;
    }

    const packedPoints = new Float32Array(pointCount * 3);
    let idx = 0;

    for (const cmd of commands) {
      for (const pt of cmd.points) {
        packedPoints[idx++] = pt.x;
        packedPoints[idx++] = pt.y;
        packedPoints[idx++] = pt.z;
      }
    }

    const attributes: Record<string, string> = {};
    for (const attr of pathEl.attributes) {
      if (attr.name !== 'd') {
        attributes[attr.name] = attr.value;
      }
    }

    paths.push({ commands, packedPoints, attributes });
  });

  return paths;
}
