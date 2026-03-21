/* ========================================
   GAZO98 - 変換Worker
   メディアンカット・肌色検出・領域分離・肌専用ディザ
   ======================================== */

const STEP = 17;

/* =============================================
   基本ユーティリティ
   ============================================= */

function snapToPC98(r, g, b) {
    return [
        Math.round(r / STEP) * STEP,
        Math.round(g / STEP) * STEP,
        Math.round(b / STEP) * STEP
    ];
}

function clamp(val, min, max) {
    return val < min ? min : val > max ? max : val;
}

/* =============================================
   肌色検出
   ============================================= */

function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;

    let h = 0, s = 0, v = max;
    if (max > 0) s = d / max;
    if (d > 0) {
        if (max === r) h = ((g - b) / d + 6) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
    }
    return [h, s, v];
}

function isSkinHSV(r, g, b, params) {
    const [h, s, v] = rgbToHsv(r, g, b);
    if (h < params.hMin || h > params.hMax) return false;
    if (s < params.sMin || s > params.sMax) return false;
    if (v < params.vMin || v > params.vMax) return false;
    if (!(r > g && g > b)) return false;
    if ((r - g) > 80) return false;
    if ((r - b) < 20) return false;
    return true;
}

/* 旧来の簡易肌色判定（後方互換） */
function isSkinToneSimple(r, g, b) {
    return r > 80 && g > 40 && b > 20 &&
           r > g && g > b &&
           (r - g) > 10 && (r - b) > 30 &&
           r < 255 && g < 230 && b < 200;
}

function dilate(mask, w, h) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let found = false;
            for (let dy = -1; dy <= 1 && !found; dy++) {
                for (let dx = -1; dx <= 1 && !found; dx++) {
                    const nx = x + dx, ny = y + dy;
                    if (nx >= 0 && nx < w && ny >= 0 && ny < h && mask[ny * w + nx]) {
                        found = true;
                    }
                }
            }
            out[y * w + x] = found ? 1 : 0;
        }
    }
    return out;
}

function erode(mask, w, h) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let allSet = true;
            for (let dy = -1; dy <= 1 && allSet; dy++) {
                for (let dx = -1; dx <= 1 && allSet; dx++) {
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || nx >= w || ny < 0 || ny >= h || !mask[ny * w + nx]) {
                        allSet = false;
                    }
                }
            }
            out[y * w + x] = allSet ? 1 : 0;
        }
    }
    return out;
}

function generateSkinMask(data, w, h, params) {
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
        const idx = i * 4;
        mask[i] = isSkinHSV(data[idx], data[idx + 1], data[idx + 2], params) ? 1 : 0;
    }
    let result = dilate(mask, w, h);
    result = dilate(result, w, h);
    result = erode(result, w, h);
    return result;
}

/* 境界距離マップ生成（ブレンドゾーン用） */
function generateBorderDistance(mask, w, h, maxDist) {
    const dist = new Float32Array(w * h);
    dist.fill(maxDist + 1);

    /* マスク境界のピクセルを検出 */
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = y * w + x;
            if (!mask[i]) continue;

            let isBorder = false;
            for (let dy = -1; dy <= 1 && !isBorder; dy++) {
                for (let dx = -1; dx <= 1 && !isBorder; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || nx >= w || ny < 0 || ny >= h || !mask[ny * w + nx]) {
                        isBorder = true;
                    }
                }
            }
            if (isBorder) dist[i] = 0;
        }
    }

    /* 簡易距離伝播（2パス） */
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = y * w + x;
            if (!mask[i]) continue;
            if (y > 0) dist[i] = Math.min(dist[i], dist[(y - 1) * w + x] + 1);
            if (x > 0) dist[i] = Math.min(dist[i], dist[y * w + x - 1] + 1);
        }
    }
    for (let y = h - 1; y >= 0; y--) {
        for (let x = w - 1; x >= 0; x--) {
            const i = y * w + x;
            if (!mask[i]) continue;
            if (y < h - 1) dist[i] = Math.min(dist[i], dist[(y + 1) * w + x] + 1);
            if (x < w - 1) dist[i] = Math.min(dist[i], dist[y * w + x + 1] + 1);
        }
    }

    return dist;
}

/* =============================================
   メディアンカット
   ============================================= */

function extractPixels(data, totalPixels) {
    const pixels = [];
    const sampleStep = Math.max(1, Math.floor(totalPixels / 10000));
    for (let i = 0; i < totalPixels; i += sampleStep) {
        const idx = i * 4;
        pixels.push([data[idx], data[idx + 1], data[idx + 2]]);
    }
    return pixels;
}

function getBucketRange(bucket) {
    let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
    for (const px of bucket) {
        if (px[0] < rMin) rMin = px[0];
        if (px[0] > rMax) rMax = px[0];
        if (px[1] < gMin) gMin = px[1];
        if (px[1] > gMax) gMax = px[1];
        if (px[2] < bMin) bMin = px[2];
        if (px[2] > bMax) bMax = px[2];
    }
    const rRange = rMax - rMin;
    const gRange = gMax - gMin;
    const bRange = bMax - bMin;

    let maxAxis = 0, maxRange = rRange;
    if (gRange > maxRange) { maxAxis = 1; maxRange = gRange; }
    if (bRange > maxRange) { maxAxis = 2; maxRange = bRange; }

    return { maxAxis, maxRange };
}

function runMedianCut(pixels, numColors) {
    if (pixels.length === 0) return [];

    let buckets = [pixels];

    while (buckets.length < numColors) {
        let maxRange = -1;
        let maxIdx = 0;
        for (let i = 0; i < buckets.length; i++) {
            const range = getBucketRange(buckets[i]);
            if (range.maxRange > maxRange) {
                maxRange = range.maxRange;
                maxIdx = i;
            }
        }
        if (maxRange <= 0) break;

        const bucket = buckets[maxIdx];
        const range = getBucketRange(bucket);
        const axis = range.maxAxis;
        bucket.sort((a, b) => a[axis] - b[axis]);
        const mid = Math.floor(bucket.length / 2);
        const left = bucket.slice(0, mid);
        const right = bucket.slice(mid);
        if (left.length === 0 || right.length === 0) break;
        buckets.splice(maxIdx, 1, left, right);
    }

    const palette = buckets.map(bucket => {
        let rSum = 0, gSum = 0, bSum = 0;
        for (const px of bucket) {
            rSum += px[0]; gSum += px[1]; bSum += px[2];
        }
        const len = bucket.length;
        return snapToPC98(rSum / len, gSum / len, bSum / len);
    });

    while (palette.length < numColors) {
        palette.push([0, 0, 0]);
    }
    return palette;
}

/* --- 通常メディアンカット --- */
function medianCut(data, totalPixels, numColors) {
    self.postMessage({ type: 'progress', phase: 'median-cut', percent: 0 });
    const pixels = extractPixels(data, totalPixels);
    const result = runMedianCut(pixels, numColors);
    self.postMessage({ type: 'progress', phase: 'median-cut', percent: 100 });
    return result;
}

/* --- 肌色重視メディアンカット（旧来互換） --- */
function medianCutSkinBias(data, totalPixels, numColors) {
    self.postMessage({ type: 'progress', phase: 'median-cut', percent: 0 });
    const pixels = [];
    const sampleStep = Math.max(1, Math.floor(totalPixels / 10000));
    for (let i = 0; i < totalPixels; i += sampleStep) {
        const idx = i * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        pixels.push([r, g, b]);
        if (isSkinToneSimple(r, g, b)) {
            pixels.push([r, g, b]);
            pixels.push([r, g, b]);
        }
    }
    const result = runMedianCut(pixels, numColors);
    self.postMessage({ type: 'progress', phase: 'median-cut', percent: 100 });
    return result;
}

/* =============================================
   機能A: 重み付きメディアンカット（設定可能）
   ============================================= */

function medianCutWeighted(data, totalPixels, numColors, skinWeight, minSkinColors, detectParams) {
    self.postMessage({ type: 'progress', phase: 'skin-weighted', percent: 0 });

    const pixels = [];
    const sampleStep = Math.max(1, Math.floor(totalPixels / 10000));
    const weight = Math.round(skinWeight);

    for (let i = 0; i < totalPixels; i += sampleStep) {
        const idx = i * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        pixels.push([r, g, b]);
        if (isSkinHSV(r, g, b, detectParams)) {
            for (let w = 1; w < weight; w++) {
                pixels.push([r, g, b]);
            }
        }
    }

    self.postMessage({ type: 'progress', phase: 'skin-weighted', percent: 50 });
    let palette = runMedianCut(pixels, numColors);

    /* 最低肌色枠数の保証 */
    if (minSkinColors > 0) {
        palette = ensureMinSkinColors(palette, data, totalPixels, numColors, minSkinColors, detectParams);
    }

    self.postMessage({ type: 'progress', phase: 'skin-weighted', percent: 100 });
    return palette;
}

function ensureMinSkinColors(palette, data, totalPixels, numColors, minSkinColors, detectParams) {
    /* パレット中の肌色をカウント */
    let skinCount = 0;
    const isSkinPalette = palette.map(c => isSkinHSV(c[0], c[1], c[2], detectParams));
    for (const s of isSkinPalette) if (s) skinCount++;

    if (skinCount >= minSkinColors) return palette;

    /* 肌色ピクセルを収集 */
    const skinPixels = [];
    const sampleStep = Math.max(1, Math.floor(totalPixels / 10000));
    for (let i = 0; i < totalPixels; i += sampleStep) {
        const idx = i * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        if (isSkinHSV(r, g, b, detectParams)) {
            skinPixels.push([r, g, b]);
        }
    }

    if (skinPixels.length === 0) return palette;

    /* 非肌色パレットのうち使用頻度が低いものを肌色で置換 */
    const needed = minSkinColors - skinCount;
    const extraSkinPalette = runMedianCut(skinPixels, needed + skinCount);

    /* 非肌色パレットを使用頻度順にソート */
    const nonSkinIndices = [];
    for (let i = 0; i < palette.length; i++) {
        if (!isSkinPalette[i]) nonSkinIndices.push(i);
    }

    /* 使用頻度計算 */
    const usage = new Array(palette.length).fill(0);
    for (let i = 0; i < totalPixels; i += sampleStep) {
        const idx = i * 4;
        const nearest = findNearest(data[idx], data[idx + 1], data[idx + 2], palette);
        usage[nearest]++;
    }

    nonSkinIndices.sort((a, b) => usage[a] - usage[b]);

    /* 使用頻度が低い非肌色パレットを肌色に置換 */
    let replaced = 0;
    let skinPaletteIdx = 0;
    for (let i = 0; i < nonSkinIndices.length && replaced < needed; i++) {
        /* 追加肌色パレットから未使用のものを選ぶ */
        while (skinPaletteIdx < extraSkinPalette.length) {
            const c = extraSkinPalette[skinPaletteIdx];
            if (isSkinHSV(c[0], c[1], c[2], detectParams)) {
                palette[nonSkinIndices[i]] = c;
                replaced++;
                skinPaletteIdx++;
                break;
            }
            skinPaletteIdx++;
        }
    }

    return palette;
}

/* =============================================
   機能B: 領域分離型減色
   ============================================= */

function medianCutSeparate(data, w, h, numColors, splitMode, skinPaletteCount, detectParams) {
    self.postMessage({ type: 'progress', phase: 'region-separate', percent: 0 });

    /* Step 1: マスク生成 */
    const mask = generateSkinMask(data, w, h, detectParams);
    self.postMessage({ type: 'progress', phase: 'region-separate', percent: 20 });

    /* Step 2: ピクセル分離 */
    const skinPixels = [];
    const nonSkinPixels = [];
    const totalPixels = w * h;
    const sampleStep = Math.max(1, Math.floor(totalPixels / 10000));

    for (let i = 0; i < totalPixels; i += sampleStep) {
        const idx = i * 4;
        const px = [data[idx], data[idx + 1], data[idx + 2]];
        if (mask[i]) skinPixels.push(px);
        else nonSkinPixels.push(px);
    }

    /* Step 3: パレット枠配分 */
    let skinCount;
    if (splitMode === 'manual') {
        skinCount = skinPaletteCount;
    } else {
        const skinRatio = skinPixels.length / (skinPixels.length + nonSkinPixels.length);
        skinCount = clamp(Math.round(skinRatio * numColors * 1.5), 4, 10);
    }
    const nonSkinCount = numColors - skinCount;

    self.postMessage({ type: 'progress', phase: 'region-separate', percent: 40 });

    /* Step 4: 各領域で独立にメディアンカット */
    const skinPalette = skinPixels.length > 0
        ? runMedianCut(skinPixels, skinCount)
        : [];
    self.postMessage({ type: 'progress', phase: 'region-separate', percent: 60 });

    const nonSkinPalette = nonSkinPixels.length > 0
        ? runMedianCut(nonSkinPixels, nonSkinCount)
        : [];
    self.postMessage({ type: 'progress', phase: 'region-separate', percent: 80 });

    /* Step 5: 統合パレット */
    let palette = [...skinPalette, ...nonSkinPalette];

    /* 不足分は黒で埋める */
    while (palette.length < numColors) {
        palette.push([0, 0, 0]);
    }
    palette = palette.slice(0, numColors);

    /* 色距離が近すぎるペアの微調整 (CIE76簡易: ΔE < 5) */
    for (let i = 0; i < palette.length; i++) {
        for (let j = i + 1; j < palette.length; j++) {
            const dr = palette[i][0] - palette[j][0];
            const dg = palette[i][1] - palette[j][1];
            const db = palette[i][2] - palette[j][2];
            const dist = Math.sqrt(dr * dr + dg * dg + db * db);
            if (dist < 5 * 2.55) { /* ΔE≈5をRGB距離に換算（近似） */
                /* 片方を微調整 */
                palette[j] = snapToPC98(
                    clamp(palette[j][0] + STEP, 0, 255),
                    palette[j][1],
                    palette[j][2]
                );
            }
        }
    }

    self.postMessage({ type: 'progress', phase: 'region-separate', percent: 100 });
    return { palette, mask };
}

/* =============================================
   最近傍色マッチング
   ============================================= */

function findNearest(r, g, b, palette) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < palette.length; i++) {
        const dr = r - palette[i][0];
        const dg = g - palette[i][1];
        const db = b - palette[i][2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
        }
    }
    return bestIdx;
}

/* 2番目に近いパレット色を返す */
function findSecondNearest(r, g, b, palette, firstIdx) {
    let bestIdx = firstIdx === 0 ? 1 : 0;
    let bestDist = Infinity;
    for (let i = 0; i < palette.length; i++) {
        if (i === firstIdx) continue;
        const dr = r - palette[i][0];
        const dg = g - palette[i][1];
        const db = b - palette[i][2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
        }
    }
    return bestIdx;
}

/* =============================================
   肌専用ディザパターン（機能C）
   ============================================= */

const SKIN_DITHER_PATTERNS = {
    smooth: {
        size: 4,
        matrix: [
             1,  9,  3, 11,
            13,  5, 15,  7,
             4, 12,  2, 10,
            16,  8, 14,  6
        ]
    },
    halftone: {
        size: 6,
        matrix: [
            35, 26, 22, 23, 27, 36,
            25, 14,  9, 10, 15, 28,
            21,  8,  1,  2, 11, 24,
            20,  7,  4,  3, 12, 29,
            30, 13,  6,  5, 16, 33,
            34, 31, 19, 18, 32, 35
        ]
    },
    diagonal: {
        size: 4,
        matrix: [
             1,  5,  2,  6,
             9, 13, 10, 14,
             3,  7,  4,  8,
            11, 15, 12, 16
        ]
    }
};

function getDitherThreshold(pattern, x, y) {
    const p = SKIN_DITHER_PATTERNS[pattern];
    const idx = (y % p.size) * p.size + (x % p.size);
    const maxVal = p.size * p.size + 1;
    return p.matrix[idx] / maxVal;
}

/* =============================================
   ディザリングエンジン（Phase 4）
   ============================================= */

/* --- Bayer行列 --- */
const BAYER_2x2 = [0, 2, 3, 1];
const BAYER_4x4 = [
     0,  8,  2, 10,
    12,  4, 14,  6,
     3, 11,  1,  9,
    15,  7, 13,  5
];
const BAYER_8x8 = [
     0, 32,  8, 40,  2, 34, 10, 42,
    48, 16, 56, 24, 50, 18, 58, 26,
    12, 44,  4, 36, 14, 46,  6, 38,
    60, 28, 52, 20, 62, 30, 54, 22,
     3, 35, 11, 43,  1, 33,  9, 41,
    51, 19, 59, 27, 49, 17, 57, 25,
    15, 47,  7, 39, 13, 45,  5, 37,
    63, 31, 55, 23, 61, 29, 53, 21
];

function getBayerMatrix(size) {
    if (size === 2) return { matrix: BAYER_2x2, n: 2 };
    if (size === 8) return { matrix: BAYER_8x8, n: 8 };
    return { matrix: BAYER_4x4, n: 4 };
}

/* --- 疑似乱数（シード固定） --- */
function mulberry32(seed) {
    return function() {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

/* --- 市松パターンディザ --- */
function applyCheckerboard(data, w, h, palette, strength) {
    const out = new Uint8ClampedArray(w * h * 4);
    const s = strength / 100;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const r = data[i], g = data[i + 1], b = data[i + 2];

            const nearestIdx = findNearest(r, g, b, palette);
            if (s === 0) {
                out[i] = palette[nearestIdx][0];
                out[i + 1] = palette[nearestIdx][1];
                out[i + 2] = palette[nearestIdx][2];
                out[i + 3] = 255;
                continue;
            }

            const secondIdx = findSecondNearest(r, g, b, palette, nearestIdx);
            const nr = palette[nearestIdx], sr = palette[secondIdx];
            const d1 = Math.sqrt((r - nr[0]) ** 2 + (g - nr[1]) ** 2 + (b - nr[2]) ** 2);
            const d2 = Math.sqrt((r - sr[0]) ** 2 + (g - sr[1]) ** 2 + (b - sr[2]) ** 2);
            const total = d1 + d2;

            let chosen;
            if (total < 1) {
                chosen = nearestIdx;
            } else {
                const ratio = d1 / total;
                const threshold = ((x + y) % 2 === 0) ? 0.5 - s * 0.5 : 0.5 + s * 0.5;
                chosen = ratio > threshold ? secondIdx : nearestIdx;
            }

            out[i] = palette[chosen][0];
            out[i + 1] = palette[chosen][1];
            out[i + 2] = palette[chosen][2];
            out[i + 3] = 255;
        }
    }
    return out;
}

/* --- Bayer行列ディザ --- */
function applyBayer(data, w, h, palette, strength, bayerSize) {
    const out = new Uint8ClampedArray(w * h * 4);
    const s = strength / 100;
    const { matrix, n } = getBayerMatrix(bayerSize);
    const maxVal = n * n;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const r = data[i], g = data[i + 1], b = data[i + 2];

            /* Bayerしきい値（-0.5〜+0.5に正規化して強度適用） */
            const threshold = (matrix[(y % n) * n + (x % n)] / maxVal - 0.5) * s;

            /* しきい値をRGBに加算して最近傍マッチ */
            const bias = threshold * 255;
            const br = clamp(r + bias, 0, 255);
            const bg = clamp(g + bias, 0, 255);
            const bb = clamp(b + bias, 0, 255);

            const idx = findNearest(br, bg, bb, palette);
            out[i] = palette[idx][0];
            out[i + 1] = palette[idx][1];
            out[i + 2] = palette[idx][2];
            out[i + 3] = 255;
        }
    }
    return out;
}

/* --- Floyd-Steinberg誤差拡散ディザ --- */
function applyFloydSteinberg(data, w, h, palette, strength) {
    const s = strength / 100;
    const out = new Uint8ClampedArray(w * h * 4);

    /* 作業用バッファ（float） */
    const buf = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
        buf[i * 3] = data[i * 4];
        buf[i * 3 + 1] = data[i * 4 + 1];
        buf[i * 3 + 2] = data[i * 4 + 2];
    }

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const bi = (y * w + x) * 3;
            const r = clamp(buf[bi], 0, 255);
            const g = clamp(buf[bi + 1], 0, 255);
            const b = clamp(buf[bi + 2], 0, 255);

            const idx = findNearest(r, g, b, palette);
            const oi = (y * w + x) * 4;
            out[oi] = palette[idx][0];
            out[oi + 1] = palette[idx][1];
            out[oi + 2] = palette[idx][2];
            out[oi + 3] = 255;

            /* 誤差計算 */
            const er = (r - palette[idx][0]) * s;
            const eg = (g - palette[idx][1]) * s;
            const eb = (b - palette[idx][2]) * s;

            /* 誤差拡散 */
            if (x + 1 < w) {
                const j = bi + 3;
                buf[j] += er * 7 / 16;
                buf[j + 1] += eg * 7 / 16;
                buf[j + 2] += eb * 7 / 16;
            }
            if (y + 1 < h) {
                if (x > 0) {
                    const j = ((y + 1) * w + x - 1) * 3;
                    buf[j] += er * 3 / 16;
                    buf[j + 1] += eg * 3 / 16;
                    buf[j + 2] += eb * 3 / 16;
                }
                {
                    const j = ((y + 1) * w + x) * 3;
                    buf[j] += er * 5 / 16;
                    buf[j + 1] += eg * 5 / 16;
                    buf[j + 2] += eb * 5 / 16;
                }
                if (x + 1 < w) {
                    const j = ((y + 1) * w + x + 1) * 3;
                    buf[j] += er * 1 / 16;
                    buf[j + 1] += eg * 1 / 16;
                    buf[j + 2] += eb * 1 / 16;
                }
            }
        }

        /* 進捗報告（10行ごと） */
        if (y % 10 === 0) {
            self.postMessage({ type: 'progress', phase: 'dithering', percent: Math.round(y / h * 100) });
        }
    }
    return out;
}

/* --- ランダムディザ --- */
function applyRandom(data, w, h, palette, strength, seed) {
    const out = new Uint8ClampedArray(w * h * 4);
    const s = strength / 100;
    const rng = mulberry32(seed || 42);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const r = data[i], g = data[i + 1], b = data[i + 2];

            const noise = (rng() - 0.5) * s * 255;
            const br = clamp(r + noise, 0, 255);
            const bg = clamp(g + noise, 0, 255);
            const bb = clamp(b + noise, 0, 255);

            const idx = findNearest(br, bg, bb, palette);
            out[i] = palette[idx][0];
            out[i + 1] = palette[idx][1];
            out[i + 2] = palette[idx][2];
            out[i + 3] = 255;
        }
    }
    return out;
}

/* --- ディザ選択・実行 --- */
function applyDither(data, w, h, palette, ditherType, strength, bayerSize, seed) {
    switch (ditherType) {
        case 'checkerboard': return applyCheckerboard(data, w, h, palette, strength);
        case 'bayer':        return applyBayer(data, w, h, palette, strength, bayerSize || 4);
        case 'floyd-steinberg': return applyFloydSteinberg(data, w, h, palette, strength);
        case 'random':       return applyRandom(data, w, h, palette, strength, seed);
        default:             return applyFlat(data, w, h, palette);
    }
}

/* =============================================
   変換処理
   ============================================= */

function applyFlat(data, w, h, palette) {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
        const idx = findNearest(data[i], data[i + 1], data[i + 2], palette);
        out[i] = palette[idx][0];
        out[i + 1] = palette[idx][1];
        out[i + 2] = palette[idx][2];
        out[i + 3] = 255;
    }
    return out;
}

/* 肌専用ディザ付き変換 */
function applyWithSkinDither(data, w, h, palette, mask, skinDither) {
    const out = new Uint8ClampedArray(w * h * 4);
    const pattern = skinDither.pattern || 'smooth';
    const blendWidth = skinDither.blendWidth || 4;

    /* 境界距離マップを生成 */
    const borderDist = generateBorderDistance(mask, w, h, blendWidth);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const pi = y * w + x;
            const i = pi * 4;
            const r = data[i], g = data[i + 1], b = data[i + 2];

            if (mask[pi]) {
                /* 肌色領域: 肌専用ディザ適用 */
                const threshold = getDitherThreshold(pattern, x, y);
                const nearestIdx = findNearest(r, g, b, palette);
                const secondIdx = findSecondNearest(r, g, b, palette, nearestIdx);

                /* 最近傍色との距離比率 */
                const nr = palette[nearestIdx], sr = palette[secondIdx];
                const d1 = Math.sqrt((r - nr[0]) ** 2 + (g - nr[1]) ** 2 + (b - nr[2]) ** 2);
                const d2 = Math.sqrt((r - sr[0]) ** 2 + (g - sr[1]) ** 2 + (b - sr[2]) ** 2);
                const totalDist = d1 + d2;

                let chosenIdx;
                if (totalDist < 1) {
                    chosenIdx = nearestIdx;
                } else {
                    const ratio = d1 / totalDist;

                    /* 境界ブレンド: マスク境界付近では効果を減衰 */
                    const dist = borderDist[pi];
                    let effectiveThreshold = threshold;
                    if (dist < blendWidth) {
                        const blendRatio = dist / blendWidth;
                        effectiveThreshold = threshold * blendRatio + 0.5 * (1 - blendRatio);
                    }

                    chosenIdx = ratio > effectiveThreshold ? secondIdx : nearestIdx;
                }

                out[i] = palette[chosenIdx][0];
                out[i + 1] = palette[chosenIdx][1];
                out[i + 2] = palette[chosenIdx][2];
            } else {
                /* 非肌色領域: ベタ減色 */
                const idx = findNearest(r, g, b, palette);
                out[i] = palette[idx][0];
                out[i + 1] = palette[idx][1];
                out[i + 2] = palette[idx][2];
            }
            out[i + 3] = 255;
        }
    }
    return out;
}

/* =============================================
   プリセットベース＋自動微調整
   ============================================= */

function presetAdjust(data, totalPixels, presetPalette, detectParams) {
    self.postMessage({ type: 'progress', phase: 'preset-adjust', percent: 0 });

    /* プリセットパレットを肌色/非肌色に分類 */
    const skinIndices = [];
    const nonSkinIndices = [];
    for (let i = 0; i < presetPalette.length; i++) {
        const c = presetPalette[i];
        if (isSkinHSV(c[0], c[1], c[2], detectParams)) {
            skinIndices.push(i);
        } else {
            nonSkinIndices.push(i);
        }
    }

    /* 肌色が0の場合は微調整不要 */
    if (skinIndices.length === 0 || nonSkinIndices.length === 0) {
        self.postMessage({ type: 'progress', phase: 'preset-adjust', percent: 100 });
        return presetPalette;
    }

    self.postMessage({ type: 'progress', phase: 'preset-adjust', percent: 30 });

    /* 非肌色ピクセルを収集 */
    const nonSkinPixels = [];
    const sampleStep = Math.max(1, Math.floor(totalPixels / 10000));
    for (let i = 0; i < totalPixels; i += sampleStep) {
        const idx = i * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        if (!isSkinHSV(r, g, b, detectParams)) {
            nonSkinPixels.push([r, g, b]);
        }
    }

    self.postMessage({ type: 'progress', phase: 'preset-adjust', percent: 60 });

    /* 非肌色枠だけメディアンカットで最適化 */
    const adjustedNonSkin = nonSkinPixels.length > 0
        ? runMedianCut(nonSkinPixels, nonSkinIndices.length)
        : [];

    /* パレット組み立て: 肌色はプリセットのまま、非肌色を置換 */
    const result = presetPalette.map(c => [...c]);
    for (let i = 0; i < nonSkinIndices.length; i++) {
        if (i < adjustedNonSkin.length) {
            result[nonSkinIndices[i]] = adjustedNonSkin[i];
        }
    }

    self.postMessage({ type: 'progress', phase: 'preset-adjust', percent: 100 });
    return result;
}

/* =============================================
   マスク生成（プレビュー用）
   ============================================= */

function handleGenerateMask(msg) {
    const mask = generateSkinMask(msg.data, msg.width, msg.height, msg.detectParams);

    /* マスクの肌色ピクセル数を集計 */
    let skinCount = 0;
    for (let i = 0; i < mask.length; i++) {
        if (mask[i]) skinCount++;
    }

    self.postMessage({
        type: 'mask-result',
        mask: mask,
        width: msg.width,
        height: msg.height,
        skinPixelCount: skinCount,
        totalPixels: msg.width * msg.height
    }, [mask.buffer]);
}

/* =============================================
   メッセージハンドラ
   ============================================= */

self.onmessage = function(e) {
    const msg = e.data;

    switch (msg.type) {
        case 'median-cut': {
            const palette = medianCut(msg.data, msg.totalPixels, msg.numColors || 16);
            self.postMessage({ type: 'palette-result', palette });
            break;
        }
        case 'median-cut-skin': {
            const palette = medianCutSkinBias(msg.data, msg.totalPixels, msg.numColors || 16);
            self.postMessage({ type: 'palette-result', palette });
            break;
        }
        case 'median-cut-weighted': {
            const palette = medianCutWeighted(
                msg.data, msg.totalPixels, msg.numColors || 16,
                msg.skinWeight || 3.0, msg.minSkinColors || 4,
                msg.detectParams
            );
            self.postMessage({ type: 'palette-result', palette });
            break;
        }
        case 'median-cut-separate': {
            const result = medianCutSeparate(
                msg.data, msg.width, msg.height, msg.numColors || 16,
                msg.splitMode || 'auto', msg.skinPaletteCount || 8,
                msg.detectParams
            );
            self.postMessage({
                type: 'palette-result',
                palette: result.palette,
                mask: result.mask
            });
            break;
        }
        case 'preset-adjust': {
            const palette = presetAdjust(
                msg.data, msg.totalPixels,
                msg.presetPalette, msg.detectParams
            );
            self.postMessage({ type: 'palette-result', palette });
            break;
        }
        case 'generate-mask': {
            handleGenerateMask(msg);
            break;
        }
        case 'convert': {
            self.postMessage({ type: 'progress', phase: 'reducing', percent: 0 });

            let out;
            const skinOpts = msg.skinOptions;
            const ditherType = msg.ditherType || 'none';
            const ditherStrength = msg.ditherStrength != null ? msg.ditherStrength : 80;
            const bayerSize = msg.bayerSize || 4;
            const randomSeed = msg.randomSeed || 42;

            if (ditherType !== 'none') {
                /* ディザリング付き変換 */
                out = applyDither(msg.data, msg.width, msg.height, msg.palette,
                    ditherType, ditherStrength, bayerSize, randomSeed);

                /* 肌専用ディザが有効なら肌色領域を上書き */
                if (skinOpts && skinOpts.skinDither && skinOpts.skinDither.enabled) {
                    let mask;
                    if (msg.mask) {
                        mask = new Uint8Array(msg.mask);
                    } else {
                        mask = generateSkinMask(msg.data, msg.width, msg.height,
                            skinOpts.detectParams || { hMin: 0, hMax: 50, sMin: 0.1, sMax: 0.7, vMin: 0.2, vMax: 0.95 });
                    }
                    const skinOut = applyWithSkinDither(msg.data, msg.width, msg.height, msg.palette, mask, skinOpts.skinDither);
                    /* 肌色領域のみ skinOut で上書き */
                    for (let pi = 0; pi < mask.length; pi++) {
                        if (mask[pi]) {
                            const i = pi * 4;
                            out[i] = skinOut[i];
                            out[i + 1] = skinOut[i + 1];
                            out[i + 2] = skinOut[i + 2];
                        }
                    }
                }
            } else if (skinOpts && skinOpts.skinDither && skinOpts.skinDither.enabled) {
                /* ディザなし＋肌専用ディザのみ */
                let mask;
                if (msg.mask) {
                    mask = new Uint8Array(msg.mask);
                } else {
                    mask = generateSkinMask(msg.data, msg.width, msg.height,
                        skinOpts.detectParams || { hMin: 0, hMax: 50, sMin: 0.1, sMax: 0.7, vMin: 0.2, vMax: 0.95 });
                }
                out = applyWithSkinDither(msg.data, msg.width, msg.height, msg.palette, mask, skinOpts.skinDither);
            } else {
                out = applyFlat(msg.data, msg.width, msg.height, msg.palette);
            }

            self.postMessage({
                type: 'convert-result',
                data: out,
                width: msg.width,
                height: msg.height
            }, [out.buffer]);
            break;
        }
    }
};
