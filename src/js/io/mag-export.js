/* ========================================
   GAZO98 - MAG出力
   MAKI02 形式エンコーダ（PC-9801実機互換）

   MAGBIBLE.DOC 準拠:
   - 1ピクセル = 横4ドット = 2バイト（16色時）
   - 仮想座標: (width/4) × height
   - フラグ: 4bit（0=生データ, 1-15=デルタ位置コード）
   - フラグ圧縮: 縦XOR → FlagA(0=ゼロ)/FlagB(非ゼロバイト)
   - パレット: GRB順 各1バイト × 16色 = 48バイト
   ======================================== */

const MagExport = (() => {
    /* デルタテーブル: フラグ値1-15に対応する(dx, dy)オフセット
       MAGピクセル単位（1ピクセル=4ドット） */
    const DELTA_TABLE = [
        null,       // 0: 生データ（マッチなし）
        [-1,  0],   // 1: 1つ左
        [-2,  0],   // 2: 2つ左
        [-4,  0],   // 3: 4つ左
        [ 0, -1],   // 4: 1つ上
        [-1, -1],   // 5: 1つ上・1つ左
        [ 0, -2],   // 6: 2つ上
        [-1, -2],   // 7: 2つ上・1つ左
        [-2, -2],   // 8: 2つ上・2つ左
        [ 0, -4],   // 9: 4つ上
        [-1, -4],   // 10: 4つ上・1つ左
        [-2, -4],   // 11: 4つ上・2つ左
        [ 0, -8],   // 12: 8つ上
        [-1, -8],   // 13: 8つ上・1つ左
        [-2, -8],   // 14: 8つ上・2つ左
        [ 0,-16]    // 15: 16つ上
    ];

    /* 検索順序（仕様書推奨） */
    const SEARCH_ORDER = [1, 4, 5, 6, 7, 9, 10, 2, 8, 11, 12, 13, 14, 3, 15];

    function save(imageData, palette, fileName, comment) {
        const blob = encode(imageData, palette, comment || 'GAZO98');
        download(blob, fileName);
    }

    function encode(imageData, palette, comment) {
        const w = imageData.width;
        const h = imageData.height;
        const data = imageData.data;

        /* パレットインデックスマップ */
        const colorMap = new Map();
        for (let i = 0; i < palette.length; i++) {
            const key = (palette[i][0] << 16) | (palette[i][1] << 8) | palette[i][2];
            colorMap.set(key, i);
        }

        /* ドットをパレットインデックスに変換 */
        const indices = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) {
            const off = i * 4;
            const key = (data[off] << 16) | (data[off + 1] << 8) | data[off + 2];
            indices[i] = colorMap.get(key) || 0;
        }

        /* MAGピクセル化: 4ドット → 2バイト */
        const magW = Math.ceil(w / 4); // MAGピクセル数/行
        const magPixels = new Uint8Array(magW * h * 2); // 各2バイト

        for (let y = 0; y < h; y++) {
            for (let mx = 0; mx < magW; mx++) {
                const dx = mx * 4; // ドット座標
                const d0 = (dx < w) ? indices[y * w + dx] : 0;
                const d1 = (dx + 1 < w) ? indices[y * w + dx + 1] : 0;
                const d2 = (dx + 2 < w) ? indices[y * w + dx + 2] : 0;
                const d3 = (dx + 3 < w) ? indices[y * w + dx + 3] : 0;

                const off = (y * magW + mx) * 2;
                magPixels[off] = (d0 << 4) | d1;
                magPixels[off + 1] = (d2 << 4) | d3;
            }
        }

        /* フラグ生成: 各MAGピクセルについてデルタマッチングを行う */
        const flags = new Uint8Array(magW * h); // 4bitフラグ（0-15）
        const rawPixels = []; // フラグ=0の生データ（2バイト/個）

        for (let y = 0; y < h; y++) {
            for (let mx = 0; mx < magW; mx++) {
                const pos = y * magW + mx;
                const curB0 = magPixels[pos * 2];
                const curB1 = magPixels[pos * 2 + 1];

                /* 1つ上のフラグと同じフラグになるよう優先的に検索 */
                const aboveFlag = (y > 0) ? flags[(y - 1) * magW + mx] : 0;
                let matchFlag = 0;

                /* まず上のフラグと同じデルタを試す */
                if (aboveFlag > 0) {
                    const [ddx, ddy] = DELTA_TABLE[aboveFlag];
                    const sx = mx + ddx;
                    const sy = y + ddy;
                    if (sx >= 0 && sx < magW && sy >= 0 && sy < h) {
                        const sPos = (sy * magW + sx) * 2;
                        if (magPixels[sPos] === curB0 && magPixels[sPos + 1] === curB1) {
                            matchFlag = aboveFlag;
                        }
                    }
                }

                /* 見つからなければ推奨順で検索 */
                if (matchFlag === 0) {
                    for (const flag of SEARCH_ORDER) {
                        const [ddx, ddy] = DELTA_TABLE[flag];
                        const sx = mx + ddx;
                        const sy = y + ddy;
                        if (sx < 0 || sx >= magW || sy < 0 || sy >= h) continue;

                        const sPos = (sy * magW + sx) * 2;
                        if (magPixels[sPos] === curB0 && magPixels[sPos + 1] === curB1) {
                            matchFlag = flag;
                            break;
                        }
                    }
                }

                flags[pos] = matchFlag;

                if (matchFlag === 0) {
                    rawPixels.push(curB0, curB1);
                }
            }
        }

        /* フラグをバイトにパック（2フラグ/バイト: 上位=偶数, 下位=奇数） */
        const flagBytesPerRow = Math.ceil(magW / 2);
        const flagBytes = new Uint8Array(flagBytesPerRow * h);

        for (let y = 0; y < h; y++) {
            for (let i = 0; i < flagBytesPerRow; i++) {
                const fi = y * magW + i * 2;
                const hi = flags[fi];
                const lo = (i * 2 + 1 < magW) ? flags[fi + 1] : 0;
                flagBytes[y * flagBytesPerRow + i] = (hi << 4) | lo;
            }
        }

        /* 縦XOR圧縮（下から上へ） */
        for (let y = h - 1; y >= 1; y--) {
            for (let i = 0; i < flagBytesPerRow; i++) {
                flagBytes[y * flagBytesPerRow + i] ^= flagBytes[(y - 1) * flagBytesPerRow + i];
            }
        }

        /* FlagA / FlagB 分離 */
        const totalFlagBytes = flagBytesPerRow * h;
        const flagABits = [];
        const flagBBytes = [];

        for (let i = 0; i < totalFlagBytes; i++) {
            if (flagBytes[i] === 0) {
                flagABits.push(0);
            } else {
                flagABits.push(1);
                flagBBytes.push(flagBytes[i]);
            }
        }

        const flagAData = bitsToBytes(flagABits);
        const flagBData = new Uint8Array(flagBBytes);
        const pixelData = new Uint8Array(rawPixels);

        /* 偶数バンダリ調整 */
        const flagAPadded = padToEven(flagAData);
        const flagBPadded = padToEven(flagBData);

        /* パレット: GRB順 各1バイト × 16色 = 48バイト
           仕様: 4bit値を上位ニブルに格納、下位ビットは1で埋める
           0→0x00, 1→0x1F, 2→0x2F, ..., 15→0xFF */
        const magPalette = new Uint8Array(48);
        const expand4to8 = (v) => v === 0 ? 0 : (v << 4) | 0x0F;
        for (let i = 0; i < 16; i++) {
            const r4 = i < palette.length ? Math.round(palette[i][0] / 17) : 0;
            const g4 = i < palette.length ? Math.round(palette[i][1] / 17) : 0;
            const b4 = i < palette.length ? Math.round(palette[i][2] / 17) : 0;
            magPalette[i * 3] = expand4to8(g4);
            magPalette[i * 3 + 1] = expand4to8(r4);
            magPalette[i * 3 + 2] = expand4to8(b4);
        }

        /* コメント部 */
        const commentBytes = new TextEncoder().encode(comment);

        /* オフセット計算（ヘッダ先頭からの相対） */
        const headerInfoLen = 32;
        const paletteLen = 48;
        const flagAOffset = headerInfoLen + paletteLen;
        const flagBOffset = flagAOffset + flagAPadded.length;
        const pixelOffset = flagBOffset + flagBPadded.length;

        /* ファイル組み立て */
        const magicLen = 8;
        const commentTotalLen = commentBytes.length + 1; // +0x1A
        const headerStart = magicLen + commentTotalLen;
        const fileSize = headerStart + pixelOffset + pixelData.length;

        const buf = new Uint8Array(fileSize);
        let pos = 0;

        /* "MAKI02  " */
        const magic = [0x4D, 0x41, 0x4B, 0x49, 0x30, 0x32, 0x20, 0x20];
        for (let i = 0; i < 8; i++) buf[pos++] = magic[i];

        /* コメント + 0x1A */
        buf.set(commentBytes, pos); pos += commentBytes.length;
        buf[pos++] = 0x1A;

        /* ヘッダ情報 (32 bytes) */
        const hdr = new DataView(buf.buffer, pos, headerInfoLen);
        hdr.setUint8(0, 0);
        hdr.setUint8(1, 0);
        hdr.setUint8(2, 0);
        hdr.setUint8(3, 0x00); // 400ライン・アナログ16色
        hdr.setUint16(4, 0, true);         // X1
        hdr.setUint16(6, 0, true);         // Y1
        hdr.setUint16(8, w - 1, true);     // X2
        hdr.setUint16(10, h - 1, true);    // Y2
        hdr.setUint32(12, flagAOffset, true);
        hdr.setUint32(16, flagBOffset, true);
        hdr.setUint32(20, flagBPadded.length, true);
        hdr.setUint32(24, pixelOffset, true);
        hdr.setUint32(28, pixelData.length, true);
        pos += headerInfoLen;

        /* パレット (48 bytes) */
        buf.set(magPalette, pos); pos += paletteLen;

        /* FlagA */
        buf.set(flagAPadded, pos); pos += flagAPadded.length;

        /* FlagB */
        buf.set(flagBPadded, pos); pos += flagBPadded.length;

        /* PixelData */
        buf.set(pixelData, pos);

        return new Blob([buf], { type: 'application/octet-stream' });
    }

    function bitsToBytes(bits) {
        const byteLen = Math.ceil(bits.length / 8);
        const bytes = new Uint8Array(byteLen);
        for (let i = 0; i < bits.length; i++) {
            if (bits[i]) {
                bytes[Math.floor(i / 8)] |= (0x80 >> (i % 8));
            }
        }
        return bytes;
    }

    function padToEven(data) {
        if (data.length % 2 === 0) return data;
        const padded = new Uint8Array(data.length + 1);
        padded.set(data);
        return padded;
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
