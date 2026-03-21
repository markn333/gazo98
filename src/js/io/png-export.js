/* ========================================
   GAZO98 - PNG出力
   インデックスカラー16色 PNG エンコーダ
   ======================================== */

const PngExport = (() => {
    /**
     * 16色インデックスカラーPNG を生成してダウンロード
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

        /* ピクセルをパレットインデックスに変換（4bit packed） */
        const rowBytes = Math.ceil(w / 2); // 4bit per pixel
        const rawData = new Uint8Array(h * (1 + rowBytes)); // filter byte + data per row
        let offset = 0;
        for (let y = 0; y < h; y++) {
            rawData[offset++] = 0; // フィルタバイト: None
            for (let x = 0; x < w; x += 2) {
                const i1 = (y * w + x) * 4;
                const key1 = (data[i1] << 16) | (data[i1 + 1] << 8) | data[i1 + 2];
                const idx1 = colorMap.get(key1) || 0;

                let idx2 = 0;
                if (x + 1 < w) {
                    const i2 = (y * w + x + 1) * 4;
                    const key2 = (data[i2] << 16) | (data[i2 + 1] << 8) | data[i2 + 2];
                    idx2 = colorMap.get(key2) || 0;
                }

                rawData[offset++] = (idx1 << 4) | idx2;
            }
        }

        /* Deflate圧縮 */
        const compressed = deflateRaw(rawData);

        /* PNG構築 */
        const chunks = [];

        /* IHDR */
        const ihdr = new Uint8Array(13);
        writeUint32BE(ihdr, 0, w);
        writeUint32BE(ihdr, 4, h);
        ihdr[8] = 4;  // bit depth: 4
        ihdr[9] = 3;  // color type: indexed
        ihdr[10] = 0; // compression
        ihdr[11] = 0; // filter
        ihdr[12] = 0; // interlace
        chunks.push(makeChunk('IHDR', ihdr));

        /* PLTE */
        const plte = new Uint8Array(palette.length * 3);
        for (let i = 0; i < palette.length; i++) {
            plte[i * 3] = palette[i][0];
            plte[i * 3 + 1] = palette[i][1];
            plte[i * 3 + 2] = palette[i][2];
        }
        chunks.push(makeChunk('PLTE', plte));

        /* IDAT */
        chunks.push(makeChunk('IDAT', compressed));

        /* IEND */
        chunks.push(makeChunk('IEND', new Uint8Array(0)));

        /* PNGシグネチャ + チャンク結合 */
        const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
        const totalLen = signature.length + chunks.reduce((sum, c) => sum + c.length, 0);
        const png = new Uint8Array(totalLen);
        let pos = 0;
        png.set(signature, pos); pos += signature.length;
        for (const chunk of chunks) {
            png.set(chunk, pos); pos += chunk.length;
        }

        return new Blob([png], { type: 'image/png' });
    }

    /* --- PNG チャンク生成 --- */
    function makeChunk(type, data) {
        const chunk = new Uint8Array(4 + 4 + data.length + 4);
        writeUint32BE(chunk, 0, data.length);
        chunk[4] = type.charCodeAt(0);
        chunk[5] = type.charCodeAt(1);
        chunk[6] = type.charCodeAt(2);
        chunk[7] = type.charCodeAt(3);
        chunk.set(data, 8);
        const crc = crc32(chunk.subarray(4, 8 + data.length));
        writeUint32BE(chunk, 8 + data.length, crc);
        return chunk;
    }

    function writeUint32BE(buf, offset, val) {
        buf[offset] = (val >>> 24) & 0xff;
        buf[offset + 1] = (val >>> 16) & 0xff;
        buf[offset + 2] = (val >>> 8) & 0xff;
        buf[offset + 3] = val & 0xff;
    }

    /* --- CRC32 --- */
    const crcTable = (() => {
        const table = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) {
                c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            }
            table[n] = c;
        }
        return table;
    })();

    function crc32(buf) {
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < buf.length; i++) {
            crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    /* --- Deflate (zlib wrapper + uncompressed blocks) --- */
    function deflateRaw(data) {
        /* zlib header (CM=8, CINFO=7, no dict, FLEVEL=0) */
        const BLOCK_SIZE = 65535;
        const numBlocks = Math.ceil(data.length / BLOCK_SIZE);
        const out = new Uint8Array(2 + data.length + numBlocks * 5 + 4);
        let pos = 0;

        /* zlib header */
        out[pos++] = 0x78; // CMF
        out[pos++] = 0x01; // FLG

        /* uncompressed blocks */
        for (let i = 0; i < data.length; i += BLOCK_SIZE) {
            const remaining = data.length - i;
            const blockLen = Math.min(BLOCK_SIZE, remaining);
            const isLast = (i + blockLen >= data.length) ? 1 : 0;

            out[pos++] = isLast;
            out[pos++] = blockLen & 0xFF;
            out[pos++] = (blockLen >> 8) & 0xFF;
            out[pos++] = (~blockLen) & 0xFF;
            out[pos++] = ((~blockLen) >> 8) & 0xFF;
            out.set(data.subarray(i, i + blockLen), pos);
            pos += blockLen;
        }

        /* Adler-32 checksum */
        const adler = adler32(data);
        writeUint32BE(out, pos, adler);
        pos += 4;

        return out.subarray(0, pos);
    }

    function adler32(data) {
        let a = 1, b = 0;
        for (let i = 0; i < data.length; i++) {
            a = (a + data[i]) % 65521;
            b = (b + a) % 65521;
        }
        return ((b << 16) | a) >>> 0;
    }

    /* --- ダウンロード --- */
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
