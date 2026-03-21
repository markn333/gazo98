/* ========================================
   GAZO98 - パレット管理
   メディアンカット・プリセット・スナップ
   ======================================== */

const Palette = (() => {
    const STEP = 17; // 4bit → 8bit 変換係数
    const PALETTE_SIZE = 16;

    /* --- 4096色グリッドスナップ --- */
    function snapToPC98(r, g, b) {
        return [
            Math.round(r / STEP) * STEP,
            Math.round(g / STEP) * STEP,
            Math.round(b / STEP) * STEP
        ];
    }

    /* --- メディアンカット法 --- */
    function medianCut(imageData, numColors) {
        numColors = numColors || PALETTE_SIZE;
        const pixels = extractPixels(imageData);
        if (pixels.length === 0) return defaultPalette();

        let buckets = [pixels];

        while (buckets.length < numColors) {
            /* 最大分散のバケットを探す */
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

            /* 最大分散軸で分割 */
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

        /* 各バケットの重心を代表色としてスナップ */
        const palette = buckets.map(bucket => {
            let rSum = 0, gSum = 0, bSum = 0;
            for (const px of bucket) {
                rSum += px[0];
                gSum += px[1];
                bSum += px[2];
            }
            const len = bucket.length;
            return snapToPC98(rSum / len, gSum / len, bSum / len);
        });

        /* 不足分は黒で埋める */
        while (palette.length < numColors) {
            palette.push([0, 0, 0]);
        }

        return palette;
    }

    /* --- 肌色重視メディアンカット --- */
    function medianCutSkinBias(imageData, numColors) {
        numColors = numColors || PALETTE_SIZE;
        const data = imageData.data;
        const pixels = [];
        const totalPixels = data.length / 4;
        const sampleStep = Math.max(1, Math.floor(totalPixels / 10000));

        for (let i = 0; i < totalPixels; i += sampleStep) {
            const idx = i * 4;
            const r = data[idx], g = data[idx + 1], b = data[idx + 2];
            pixels.push([r, g, b]);
            /* 肌色領域のピクセルを3倍に複製して重み付け */
            if (isSkinTone(r, g, b)) {
                pixels.push([r, g, b]);
                pixels.push([r, g, b]);
            }
        }

        if (pixels.length === 0) return defaultPalette();

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

    /* 肌色判定（RGB空間でのヒューリスティクス） */
    function isSkinTone(r, g, b) {
        return r > 80 && g > 40 && b > 20 &&
               r > g && g > b &&
               (r - g) > 10 && (r - b) > 30 &&
               r < 255 && g < 230 && b < 200;
    }

    function extractPixels(imageData) {
        const data = imageData.data;
        const pixels = [];
        const totalPixels = data.length / 4;

        /* 大きな画像はサンプリング（最大10000ピクセル） */
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

    /* --- 最近傍色マッチング --- */
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

    /* --- ベタ減色（ディザなし） --- */
    function applyFlat(imageData, palette) {
        const src = imageData.data;
        const w = imageData.width;
        const h = imageData.height;
        const out = new ImageData(w, h);
        const dst = out.data;

        for (let i = 0; i < src.length; i += 4) {
            const idx = findNearest(src[i], src[i + 1], src[i + 2], palette);
            dst[i] = palette[idx][0];
            dst[i + 1] = palette[idx][1];
            dst[i + 2] = palette[idx][2];
            dst[i + 3] = 255;
        }
        return out;
    }

    /* --- プリセットパレット --- */
    const PRESETS = {
        'default': {
            name: '標準',
            category: 'general',
            colors: [
                [0,0,0],[17,17,34],[51,34,17],[85,51,34],
                [136,85,68],[170,119,102],[204,153,136],[238,204,187],
                [255,238,221],[255,255,255],[0,51,102],[34,102,153],
                [102,153,204],[68,102,51],[153,170,68],[204,204,102]
            ]
        },
        'warm': {
            name: '暖色系',
            category: 'general',
            colors: [
                [0,0,0],[34,0,0],[68,17,0],[102,34,0],
                [136,51,17],[170,68,34],[187,102,51],[204,136,85],
                [221,170,119],[238,204,170],[255,238,221],[255,255,238],
                [170,136,102],[204,170,136],[238,204,187],[255,255,255]
            ]
        },
        'cool': {
            name: '寒色系',
            category: 'general',
            colors: [
                [0,0,0],[0,0,34],[0,17,68],[0,34,119],
                [17,51,153],[34,85,187],[68,119,204],[102,153,221],
                [153,187,238],[204,221,255],[255,255,255],[51,0,68],
                [85,17,119],[119,34,153],[170,68,187],[204,119,221]
            ]
        },
        'sepia': {
            name: 'セピア',
            category: 'general',
            colors: [
                [0,0,0],[17,17,0],[34,34,17],[51,51,34],
                [85,68,51],[102,85,68],[119,102,85],[153,136,102],
                [170,153,119],[187,170,136],[204,187,153],[221,204,170],
                [238,221,187],[238,238,204],[255,238,221],[255,255,238]
            ]
        },
        'highcontrast': {
            name: '高コントラスト',
            category: 'general',
            colors: [
                [0,0,0],[170,0,0],[0,170,0],[170,170,0],
                [0,0,170],[170,0,170],[0,170,170],[170,170,170],
                [85,85,85],[255,0,0],[0,255,0],[255,255,0],
                [0,0,255],[255,0,255],[0,255,255],[255,255,255]
            ]
        },
        'mono': {
            name: 'モノクロ',
            category: 'general',
            colors: [
                [0,0,0],[17,17,17],[34,34,34],[51,51,51],
                [68,68,68],[85,85,85],[102,102,102],[119,119,119],
                [136,136,136],[153,153,153],[170,170,170],[187,187,187],
                [204,204,204],[221,221,221],[238,238,238],[255,255,255]
            ]
        },
        /* --- エロゲ風プリセット --- */
        'eroge_standard': {
            name: 'エロゲ標準',
            category: 'eroge',
            colors: [
                [0,0,0],[17,17,34],[85,51,34],[136,68,51],
                [170,102,68],[204,136,102],[221,170,136],[238,187,153],
                [255,221,187],[255,238,221],[136,34,34],[204,68,85],
                [51,51,136],[85,85,204],[136,170,85],[255,255,255]
            ]
        },
        'eroge_warm': {
            name: '暖色エロゲ',
            category: 'eroge',
            colors: [
                [0,0,0],[51,17,17],[102,51,34],[136,85,51],
                [170,119,85],[204,153,102],[221,170,136],[238,204,153],
                [255,221,187],[255,255,221],[170,51,34],[221,119,51],
                [102,68,34],[153,119,51],[68,68,102],[255,255,255]
            ]
        },
        'eroge_cool': {
            name: '寒色エロゲ',
            category: 'eroge',
            colors: [
                [0,0,0],[17,17,51],[68,51,51],[119,85,85],
                [153,119,119],[187,153,136],[221,187,170],[238,221,204],
                [34,34,102],[51,68,170],[85,102,221],[119,51,136],
                [68,102,68],[136,51,51],[170,170,187],[255,255,255]
            ]
        },
        'eroge_tanned': {
            name: '褐色肌',
            category: 'eroge',
            colors: [
                [0,0,0],[51,17,17],[85,34,17],[119,51,34],
                [153,85,51],[187,119,68],[204,136,85],[238,170,102],
                [255,204,136],[255,238,187],[170,51,51],[221,136,34],
                [51,51,119],[102,102,187],[85,136,51],[255,255,255]
            ]
        }
    };

    function getPreset(name) {
        const preset = PRESETS[name];
        if (!preset) return null;
        return preset.colors.map(c => [...c]);
    }

    function getPresetList() {
        return Object.keys(PRESETS).map(key => ({
            key,
            name: PRESETS[key].name,
            category: PRESETS[key].category || 'general'
        }));
    }

    function defaultPalette() {
        return getPreset('default');
    }

    /* --- パレットJSON I/O --- */
    function exportJSON(palette) {
        const pc98 = palette.map(([r, g, b]) => ({
            r: Math.round(r / STEP),
            g: Math.round(g / STEP),
            b: Math.round(b / STEP)
        }));
        return JSON.stringify({ format: 'gazo98', version: 1, palette: pc98 }, null, 2);
    }

    function importJSON(jsonStr) {
        const obj = JSON.parse(jsonStr);
        if (!obj.palette || !Array.isArray(obj.palette)) {
            throw new Error('無効なパレットファイルです');
        }
        return obj.palette.slice(0, PALETTE_SIZE).map(c => [
            (c.r || 0) * STEP,
            (c.g || 0) * STEP,
            (c.b || 0) * STEP
        ]);
    }

    /* --- ユーティリティ --- */
    function toCSS(color) {
        return `rgb(${color[0]},${color[1]},${color[2]})`;
    }

    function toHex(color) {
        const hex = c => c.toString(16).padStart(2, '0');
        return `#${hex(color[0])}${hex(color[1])}${hex(color[2])}`;
    }

    return {
        STEP, PALETTE_SIZE,
        snapToPC98, medianCut, medianCutSkinBias, findNearest, applyFlat,
        getPreset, getPresetList, defaultPalette,
        exportJSON, importJSON,
        toCSS, toHex
    };
})();
