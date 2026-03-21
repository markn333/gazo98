/* ========================================
   GAZO98 - ポストエフェクト
   適用順序: ドット感強調 → CRTにじみ → スキャンライン
   ======================================== */

const PostEffect = (() => {

    /**
     * 全エフェクトを適用順序に従って適用
     * @param {ImageData} imageData - 入力画像
     * @param {Object} options - エフェクト設定
     * @returns {ImageData} エフェクト適用済み画像
     */
    function apply(imageData, options) {
        let canvas = document.createElement('canvas');
        canvas.width = imageData.width;
        canvas.height = imageData.height;
        let ctx = canvas.getContext('2d');
        ctx.putImageData(imageData, 0, 0);

        /* 適用順序: ドット感強調 → CRTにじみ → スキャンライン */
        if (options.sharp && options.sharp.enabled) {
            canvas = applySharpen(canvas, options.sharp.strength || 50);
        }
        if (options.crt && options.crt.enabled) {
            canvas = applyCRT(canvas, options.crt.strength || 50);
        }
        if (options.scanline && options.scanline.enabled) {
            canvas = applyScanline(canvas, options.scanline.strength || 50);
        }

        ctx = canvas.getContext('2d');
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
    }

    /* --- ドット感強調（アンシャープマスク） --- */
    function applySharpen(srcCanvas, strength) {
        const w = srcCanvas.width;
        const h = srcCanvas.height;
        const ctx = srcCanvas.getContext('2d');
        const src = ctx.getImageData(0, 0, w, h);
        const dst = ctx.createImageData(w, h);
        const sd = src.data;
        const dd = dst.data;
        const s = strength / 100;

        /* 3x3 シャープネスカーネル（中心強調） */
        const amount = 1 + s * 3; // 1.0〜4.0
        const side = -(amount - 1) / 4;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;

                for (let c = 0; c < 3; c++) {
                    let val = sd[i + c] * amount;

                    /* 4近傍 */
                    if (y > 0) val += sd[((y - 1) * w + x) * 4 + c] * side;
                    if (y < h - 1) val += sd[((y + 1) * w + x) * 4 + c] * side;
                    if (x > 0) val += sd[(y * w + x - 1) * 4 + c] * side;
                    if (x < w - 1) val += sd[(y * w + x + 1) * 4 + c] * side;

                    dd[i + c] = Math.max(0, Math.min(255, Math.round(val)));
                }
                dd[i + 3] = 255;
            }
        }

        const outCanvas = document.createElement('canvas');
        outCanvas.width = w;
        outCanvas.height = h;
        outCanvas.getContext('2d').putImageData(dst, 0, 0);
        return outCanvas;
    }

    /* --- CRTにじみ（RGBずれ + ガウシアングロー） --- */
    function applyCRT(srcCanvas, strength) {
        const w = srcCanvas.width;
        const h = srcCanvas.height;
        const s = strength / 100;

        const outCanvas = document.createElement('canvas');
        outCanvas.width = w;
        outCanvas.height = h;
        const outCtx = outCanvas.getContext('2d');

        /* ベース画像をコピー */
        outCtx.drawImage(srcCanvas, 0, 0);

        /* RGBずれ: R/Bチャンネルを左右にずらす */
        const shift = Math.round(s * 2); // 0〜2px
        if (shift > 0) {
            const srcCtx = srcCanvas.getContext('2d');
            const srcData = srcCtx.getImageData(0, 0, w, h);
            const dstData = outCtx.getImageData(0, 0, w, h);
            const sd = srcData.data;
            const dd = dstData.data;

            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const i = (y * w + x) * 4;

                    /* R: 右にずらす */
                    const rx = Math.min(x + shift, w - 1);
                    dd[i] = sd[(y * w + rx) * 4];

                    /* G: そのまま */
                    dd[i + 1] = sd[i + 1];

                    /* B: 左にずらす */
                    const bx = Math.max(x - shift, 0);
                    dd[i + 2] = sd[(y * w + bx) * 4 + 2];

                    dd[i + 3] = 255;
                }
            }

            outCtx.putImageData(dstData, 0, 0);
        }

        /* グロー: ぼかし合成 */
        if (s > 0.2) {
            const glowCanvas = document.createElement('canvas');
            glowCanvas.width = w;
            glowCanvas.height = h;
            const glowCtx = glowCanvas.getContext('2d');
            glowCtx.filter = `blur(${Math.round(s * 3)}px)`;
            glowCtx.drawImage(outCanvas, 0, 0);

            outCtx.globalAlpha = s * 0.3;
            outCtx.globalCompositeOperation = 'screen';
            outCtx.drawImage(glowCanvas, 0, 0);
            outCtx.globalAlpha = 1;
            outCtx.globalCompositeOperation = 'source-over';
        }

        return outCanvas;
    }

    /* --- スキャンライン --- */
    function applyScanline(srcCanvas, strength) {
        const w = srcCanvas.width;
        const h = srcCanvas.height;
        const s = strength / 100;

        const outCanvas = document.createElement('canvas');
        outCanvas.width = w;
        outCanvas.height = h;
        const outCtx = outCanvas.getContext('2d');

        /* ベース画像 */
        outCtx.drawImage(srcCanvas, 0, 0);

        /* 偶数行を暗くする（CRTの走査線間の暗い隙間を再現） */
        const lineData = outCtx.getImageData(0, 0, w, h);
        const d = lineData.data;
        const darkFactor = 1 - s * 0.6; // 0.4〜1.0

        for (let y = 0; y < h; y++) {
            if (y % 2 === 1) { // 奇数行（0始まりなので偶数ピクセル行）を暗く
                for (let x = 0; x < w; x++) {
                    const i = (y * w + x) * 4;
                    d[i] = Math.round(d[i] * darkFactor);
                    d[i + 1] = Math.round(d[i + 1] * darkFactor);
                    d[i + 2] = Math.round(d[i + 2] * darkFactor);
                }
            }
        }

        outCtx.putImageData(lineData, 0, 0);
        return outCanvas;
    }

    return { apply };
})();
