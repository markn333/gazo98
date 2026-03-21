/* ========================================
   GAZO98 - BMP出力
   4bitインデックスカラー BMP エンコーダ
   ======================================== */

const BmpExport = (() => {
    /**
     * 4bit インデックスカラー BMP を生成してダウンロード
     * @param {ImageData} imageData - 変換済み画像
     * @param {Array} palette - 16色パレット [[r,g,b],...]
     * @param {string} fileName - ファイル名
     */
    function save(imageData, palette, fileName) {
        const blob = encode(imageData, palette);
        download(blob, fileName);
    }

    function encode(imageData, palette) {
        const w = imageData.width;
        const h = imageData.height;
        const data = imageData.data;

        /* パレットインデックスマップ構築 */
        const colorMap = new Map();
        for (let i = 0; i < palette.length; i++) {
            const key = (palette[i][0] << 16) | (palette[i][1] << 8) | palette[i][2];
            colorMap.set(key, i);
        }

        /* 4bit BMP: 1行あたりのバイト数（4byte境界アライン） */
        const rowBytes = Math.ceil(w / 2);
        const rowPadded = (rowBytes + 3) & ~3; // 4byte alignment

        /* ファイルサイズ計算 */
        const paletteSize = 16 * 4; // 16色 × BGRA
        const headerSize = 14;      // BITMAPFILEHEADER
        const infoSize = 40;        // BITMAPINFOHEADER
        const pixelOffset = headerSize + infoSize + paletteSize;
        const pixelDataSize = rowPadded * h;
        const fileSize = pixelOffset + pixelDataSize;

        const buf = new ArrayBuffer(fileSize);
        const view = new DataView(buf);
        const bytes = new Uint8Array(buf);

        /* BITMAPFILEHEADER (14 bytes) */
        view.setUint8(0, 0x42); // 'B'
        view.setUint8(1, 0x4D); // 'M'
        view.setUint32(2, fileSize, true);
        view.setUint32(6, 0, true);     // reserved
        view.setUint32(10, pixelOffset, true);

        /* BITMAPINFOHEADER (40 bytes) */
        view.setUint32(14, infoSize, true);
        view.setInt32(18, w, true);
        view.setInt32(22, h, true);      // 正の高さ = ボトムアップ
        view.setUint16(26, 1, true);     // planes
        view.setUint16(28, 4, true);     // bpp = 4
        view.setUint32(30, 0, true);     // compression = BI_RGB
        view.setUint32(34, pixelDataSize, true);
        view.setInt32(38, 3780, true);   // X pixels/meter (~96dpi)
        view.setInt32(42, 3780, true);   // Y pixels/meter
        view.setUint32(46, 16, true);    // colors used
        view.setUint32(50, 16, true);    // important colors

        /* パレット (BGRA × 16) */
        for (let i = 0; i < 16; i++) {
            const off = 54 + i * 4;
            if (i < palette.length) {
                view.setUint8(off, palette[i][2]);     // B
                view.setUint8(off + 1, palette[i][1]); // G
                view.setUint8(off + 2, palette[i][0]); // R
            }
            view.setUint8(off + 3, 0); // Reserved
        }

        /* ピクセルデータ（ボトムアップ、4bit packed） */
        for (let y = 0; y < h; y++) {
            const srcY = h - 1 - y; // BMP はボトムアップ
            const rowOffset = pixelOffset + y * rowPadded;

            for (let x = 0; x < w; x += 2) {
                const i1 = (srcY * w + x) * 4;
                const key1 = (data[i1] << 16) | (data[i1 + 1] << 8) | data[i1 + 2];
                const idx1 = colorMap.get(key1) || 0;

                let idx2 = 0;
                if (x + 1 < w) {
                    const i2 = (srcY * w + x + 1) * 4;
                    const key2 = (data[i2] << 16) | (data[i2 + 1] << 8) | data[i2 + 2];
                    idx2 = colorMap.get(key2) || 0;
                }

                bytes[rowOffset + (x >> 1)] = (idx1 << 4) | idx2;
            }
        }

        return new Blob([buf], { type: 'image/bmp' });
    }

    function download(blob, fileName) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    return { save, encode };
})();
