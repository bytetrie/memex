// QR Code encoder (ISO/IEC 18004), written here rather than taken from a library: byte mode
// (UTF-8), versions 1-40, error correction L/M/Q/H, the smallest version that fits, and the mask
// with the lowest penalty. Pure; the qr element draws the result as vector squares (Qr.tsx).
// The structure follows the well-known reference algorithm (Project Nayuki's, MIT): codewords,
// Reed-Solomon blocks, function patterns, zig-zag placement, masking, format and version bits.

export type Ecc = "L" | "M" | "Q" | "H";
export type QrCode = { version: number; size: number; modules: boolean[][] };

// Indexed by version (index 0 unused).
const ECC_CODEWORDS_PER_BLOCK: Record<Ecc, readonly number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
const NUM_ERROR_CORRECTION_BLOCKS: Record<Ecc, readonly number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};
const FORMAT_BITS: Record<Ecc, number> = { L: 1, M: 0, Q: 3, H: 2 };

const at = (table: readonly number[], i: number) => table[i] ?? 0;
const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

function rawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

const dataCodewords = (ver: number, ecc: Ecc) => Math.floor(rawDataModules(ver) / 8) - at(ECC_CODEWORDS_PER_BLOCK[ecc], ver) * at(NUM_ERROR_CORRECTION_BLOCKS[ecc], ver);

// --- Reed-Solomon over GF(2^8), polynomial 0x11D ----------------------------------------------

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result: number[] = Array.from({ length: degree }, () => 0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j] ?? 0, root);
      if (j + 1 < degree) result[j] = (result[j] ?? 0) ^ (result[j + 1] ?? 0);
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result: number[] = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() ?? 0);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] = (result[i] ?? 0) ^ gfMul(coef, factor);
    });
  }
  return result;
}

// --- codewords ----------------------------------------------------------------------------------

function codewords(bytes: Uint8Array, ecc: Ecc): { version: number; data: number[] } {
  let version = 0;
  for (let v = 1; v <= 40; v++) {
    const countBits = v <= 9 ? 8 : 16;
    if (bytes.length < 2 ** countBits && 4 + countBits + bytes.length * 8 <= dataCodewords(v, ecc) * 8) {
      version = v;
      break;
    }
  }
  if (version === 0) throw new Error("Too much text for a QR code at this error correction level.");
  const bits: number[] = [];
  const push = (value: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacity = dataCodewords(version, ecc) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));
  return { version, data };
}

function withEcc(data: number[], version: number, ecc: Ecc): number[] {
  const numBlocks = at(NUM_ERROR_CORRECTION_BLOCKS[ecc], version);
  const blockEccLen = at(ECC_CODEWORDS_PER_BLOCK[ecc], version);
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const divisor = rsDivisor(blockEccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const eccBytes = rsRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push([...dat, ...eccBytes]);
  }
  const result: number[] = [];
  const blockLen = blocks[0]?.length ?? 0;
  for (let i = 0; i < blockLen; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i] ?? 0);
    });
  }
  return result;
}

// --- the symbol ---------------------------------------------------------------------------------

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const num = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (num * 2 - 2)) * 2;
  const result = [6];
  for (let pos = version * 4 + 10; result.length < num; pos -= step) result.splice(1, 0, pos);
  return result;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

class Grid {
  size: number;
  modules: boolean[][];
  fn: boolean[][];
  constructor(version: number) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => Array.from({ length: this.size }, () => false));
    this.fn = Array.from({ length: this.size }, () => Array.from({ length: this.size }, () => false));
  }
  get(x: number, y: number): boolean {
    return this.modules[y]?.[x] ?? false;
  }
  set(x: number, y: number, dark: boolean, isFunction = true) {
    const row = this.modules[y];
    const fnRow = this.fn[y];
    if (!row || !fnRow || x < 0 || x >= this.size) return;
    row[x] = dark;
    if (isFunction) fnRow[x] = true;
  }
  isFunction(x: number, y: number): boolean {
    return this.fn[y]?.[x] ?? false;
  }
}

function drawFunctionPatterns(s: Grid, version: number) {
  for (let i = 0; i < s.size; i++) {
    s.set(6, i, i % 2 === 0);
    s.set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [s.size - 4, 3], [3, s.size - 4]] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < s.size && y >= 0 && y < s.size) s.set(x, y, dist !== 2 && dist !== 4);
      }
    }
  }
  const pos = alignmentPositions(version);
  const n = pos.length;
  pos.forEach((ay, i) => {
    pos.forEach((ax, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) s.set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    });
  });
  drawFormatBits(s, "L", 0); // reserves the area; drawn for real once the mask is chosen
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = s.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      s.set(a, b, bit(bits, i));
      s.set(b, a, bit(bits, i));
    }
  }
}

function drawFormatBits(s: Grid, ecc: Ecc, mask: number) {
  const data = (FORMAT_BITS[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  for (let i = 0; i <= 5; i++) s.set(8, i, bit(bits, i));
  s.set(8, 7, bit(bits, 6));
  s.set(8, 8, bit(bits, 7));
  s.set(7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i++) s.set(14 - i, 8, bit(bits, i));
  for (let i = 0; i < 8; i++) s.set(s.size - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i++) s.set(8, s.size - 15 + i, bit(bits, i));
  s.set(8, s.size - 8, true); // the dark module
}

function drawCodewords(s: Grid, data: number[]) {
  let i = 0;
  for (let right = s.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < s.size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? s.size - 1 - vert : vert;
        if (!s.isFunction(x, y) && i < data.length * 8) {
          s.set(x, y, bit(data[i >>> 3] ?? 0, 7 - (i & 7)), false);
          i++;
        }
      }
    }
  }
}

function applyMask(s: Grid, mask: number) {
  const test = MASKS[mask];
  if (!test) return;
  for (let y = 0; y < s.size; y++) for (let x = 0; x < s.size; x++) if (!s.isFunction(x, y) && test(x, y)) s.set(x, y, !s.get(x, y), false);
}

// The standard penalty: long runs, 2x2 blocks, finder-like patterns, imbalance of dark modules.
export function penalty(modules: boolean[][]): number {
  const size = modules.length;
  const get = (x: number, y: number) => modules[y]?.[x] ?? false;
  let score = 0;
  const lines = (horizontal: boolean) => Array.from({ length: size }, (_, a) => Array.from({ length: size }, (_, b) => (horizontal ? get(b, a) : get(a, b))));
  const finder = [true, false, true, true, true, false, true];
  for (const line of [...lines(true), ...lines(false)]) {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    for (let i = 0; i + 7 <= size; i++) {
      if (!finder.every((v, k) => line[i + k] === v)) continue;
      const lightBefore = [1, 2, 3, 4].every((k) => i - k < 0 || line[i - k] === false);
      const lightAfter = [0, 1, 2, 3].every((k) => i + 7 + k >= size || line[i + 7 + k] === false);
      if (lightBefore) score += 40;
      if (lightAfter) score += 40;
    }
  }
  for (let y = 0; y + 1 < size; y++) for (let x = 0; x + 1 < size; x++) if (get(x, y) === get(x + 1, y) && get(x, y) === get(x, y + 1) && get(x, y) === get(x + 1, y + 1)) score += 3;
  const dark = modules.flat().filter(Boolean).length;
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

export function encodeQr(text: string, ecc: Ecc): QrCode {
  const { version, data } = codewords(new TextEncoder().encode(text), ecc);
  const all = withEcc(data, version, ecc);
  const s = new Grid(version);
  drawFunctionPatterns(s, version);
  drawCodewords(s, all);
  let best = { mask: 0, score: Infinity };
  for (let mask = 0; mask < 8; mask++) {
    applyMask(s, mask);
    drawFormatBits(s, ecc, mask);
    const score = penalty(s.modules);
    if (score < best.score) best = { mask, score };
    applyMask(s, mask); // XOR again undoes it
  }
  applyMask(s, best.mask);
  drawFormatBits(s, ecc, best.mask);
  return { version, size: s.size, modules: s.modules };
}

// The dark modules as one SVG path in module units, offset by `margin` modules.
export function qrPath(code: QrCode, margin: number): string {
  const parts: string[] = [];
  code.modules.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x++;
      parts.push(`M${String(start + margin)} ${String(y + margin)}h${String(x - start)}v1h${String(start - x)}z`);
    }
  });
  return parts.join("");
}
