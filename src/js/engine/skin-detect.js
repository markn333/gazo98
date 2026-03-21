/* ========================================
   GAZO98 - 肌色検出エンジン
   HSV変換・肌色判定・モルフォロジー・マスク生成
   ======================================== */

const SkinDetect = (() => {
    const DEFAULT_PARAMS = {
        hMin: 0, hMax: 50,
        sMin: 0.1, sMax: 0.7,
        vMin: 0.2, vMax: 0.95
    };

    /* --- RGB → HSV 変換 --- */
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

    /* --- 肌色判定（HSV + RGB補助フィルタ） --- */
    function isSkin(r, g, b, params) {
        params = params || DEFAULT_PARAMS;

        const [h, s, v] = rgbToHsv(r, g, b);
        if (h < params.hMin || h > params.hMax) return false;
        if (s < params.sMin || s > params.sMax) return false;
        if (v < params.vMin || v > params.vMax) return false;

        /* RGB補助条件 */
        if (!(r > g && g > b)) return false;
        if ((r - g) > 80) return false;
        if ((r - b) < 20) return false;

        return true;
    }

    /* --- 膨張（3×3カーネル） --- */
    function dilate(mask, w, h) {
        const out = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let found = false;
                for (let dy = -1; dy <= 1 && !found; dy++) {
                    for (let dx = -1; dx <= 1 && !found; dx++) {
                        const nx = x + dx, ny = y + dy;
                        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                            if (mask[ny * w + nx]) found = true;
                        }
                    }
                }
                out[y * w + x] = found ? 1 : 0;
            }
        }
        return out;
    }

    /* --- 収縮（3×3カーネル） --- */
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

    /* --- マスク生成（肌色判定 + モルフォロジー平滑化） --- */
    function generateMask(imageData, params) {
        const w = imageData.width;
        const h = imageData.height;
        const data = imageData.data;
        const mask = new Uint8Array(w * h);

        for (let i = 0; i < w * h; i++) {
            const idx = i * 4;
            mask[i] = isSkin(data[idx], data[idx + 1], data[idx + 2], params) ? 1 : 0;
        }

        /* モルフォロジー: 膨張×2 → 収縮×1 */
        let result = dilate(mask, w, h);
        result = dilate(result, w, h);
        result = erode(result, w, h);

        return result;
    }

    /* --- マスクオーバーレイ画像を生成（赤色半透明） --- */
    function createOverlay(mask, w, h) {
        const overlay = new ImageData(w, h);
        const data = overlay.data;
        for (let i = 0; i < w * h; i++) {
            const idx = i * 4;
            if (mask[i]) {
                data[idx] = 255;
                data[idx + 1] = 0;
                data[idx + 2] = 0;
                data[idx + 3] = 80;
            }
        }
        return overlay;
    }

    return {
        DEFAULT_PARAMS,
        rgbToHsv, isSkin,
        generateMask, createOverlay,
        dilate, erode
    };
})();
