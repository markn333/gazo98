/* ========================================
   GAZO98 - プレビュー＆比較
   スワイプ比較・ズーム・表示モード切替
   ======================================== */

const Preview = (() => {
    let canvas = null;
    let ctx = null;
    let area = null;

    /* 状態 */
    let mode = 'converted'; // 'original' | 'converted' | 'compare'
    let zoom = 1;
    let panX = 0, panY = 0;
    let splitX = 0.5; // スワイプ分割位置（0-1）
    let active = false; // Previewが有効か（変換完了後のみtrue）

    /* 画像データ */
    let originalCanvas = null;
    let convertedCanvas = null;

    /* ドラッグ状態 */
    let dragging = false;
    let dragType = null; // 'pan' | 'split'
    let dragStartX = 0, dragStartY = 0;
    let dragStartPanX = 0, dragStartPanY = 0;

    function init(canvasEl, areaEl) {
        canvas = canvasEl;
        area = areaEl;
        ctx = canvas.getContext('2d');

        canvas.addEventListener('mousedown', onMouseDown);
        canvas.addEventListener('mousemove', onMouseMove);
        canvas.addEventListener('mouseup', onMouseUp);
        canvas.addEventListener('mouseleave', onMouseUp);
        canvas.addEventListener('wheel', onWheel, { passive: false });

        /* タッチ対応 */
        canvas.addEventListener('touchstart', onTouchStart, { passive: false });
        canvas.addEventListener('touchmove', onTouchMove, { passive: false });
        canvas.addEventListener('touchend', onTouchEnd);
    }

    function setImages(origImageData, convImageData) {
        if (origImageData) {
            originalCanvas = imageDataToCanvas(origImageData);
        }
        if (convImageData) {
            convertedCanvas = imageDataToCanvas(convImageData);
        }
        zoom = 1;
        panX = 0;
        panY = 0;
        active = true;
        render();
    }

    function setConvertedImage(convImageData) {
        convertedCanvas = imageDataToCanvas(convImageData);
        render();
    }

    function setMode(newMode) {
        mode = newMode;
        canvas.style.cursor = (mode === 'compare') ? 'col-resize' : 'grab';
        render();
    }

    function setZoom(z) {
        zoom = Math.max(1, Math.min(8, z));
        clampPan();
        render();
    }

    function getMode() { return mode; }
    function getZoom() { return zoom; }

    function reset() {
        mode = 'converted';
        zoom = 1;
        panX = 0;
        panY = 0;
        splitX = 0.5;
        active = false;
        originalCanvas = null;
        convertedCanvas = null;
    }

    /* --- 描画 --- */
    function render() {
        if (!canvas || !area) return;

        const src = (mode === 'original') ? originalCanvas : convertedCanvas;
        if (!src) return;

        const areaW = area.clientWidth;
        const areaH = area.clientHeight;
        const imgW = src.width;
        const imgH = src.height;

        /* キャンバスサイズをプレビューエリアにフィット */
        const baseScale = Math.min(areaW / imgW, areaH / imgH, 1);
        const scale = baseScale * zoom;
        const drawW = Math.floor(imgW * scale);
        const drawH = Math.floor(imgH * scale);

        canvas.width = Math.min(drawW, areaW);
        canvas.height = Math.min(drawH, areaH);
        ctx.imageSmoothingEnabled = false;

        if (mode === 'compare' && originalCanvas && convertedCanvas) {
            renderCompare(scale, drawW, drawH);
        } else {
            /* 単体表示: panX/Yはソース座標上のオフセット */
            ctx.drawImage(src,
                panX / scale, panY / scale, canvas.width / scale, canvas.height / scale,
                0, 0, canvas.width, canvas.height
            );
        }
    }

    function renderCompare(scale, drawW, drawH) {
        const cw = canvas.width;
        const ch = canvas.height;
        const splitPx = Math.round(cw * splitX);

        /* 左側: 原画像 */
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, splitPx, ch);
        ctx.clip();
        ctx.drawImage(originalCanvas,
            panX / scale, panY / scale, cw / scale, ch / scale,
            0, 0, cw, ch
        );
        ctx.restore();

        /* 右側: 変換後 */
        ctx.save();
        ctx.beginPath();
        ctx.rect(splitPx, 0, cw - splitPx, ch);
        ctx.clip();
        ctx.drawImage(convertedCanvas,
            panX / scale, panY / scale, cw / scale, ch / scale,
            0, 0, cw, ch
        );
        ctx.restore();

        /* 分割線 */
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.moveTo(splitPx, 0);
        ctx.lineTo(splitPx, ch);
        ctx.stroke();
        ctx.shadowBlur = 0;

        /* ラベル */
        ctx.font = '12px sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillText('原画像', 4, 16);
        ctx.fillText('変換後', splitPx + 4, 16);
    }

    /* --- パン制限 --- */
    function clampPan() {
        if (!convertedCanvas) return;
        const src = convertedCanvas;
        const areaW = area.clientWidth;
        const areaH = area.clientHeight;
        const baseScale = Math.min(areaW / src.width, areaH / src.height, 1);
        const scale = baseScale * zoom;
        const drawW = src.width * scale;
        const drawH = src.height * scale;

        const maxPanX = Math.max(0, drawW - areaW);
        const maxPanY = Math.max(0, drawH - areaH);
        panX = Math.max(0, Math.min(panX, maxPanX));
        panY = Math.max(0, Math.min(panY, maxPanY));
    }

    /* --- マウスイベント --- */
    function onMouseDown(e) {
        if (!active) return;
        if (mode === 'compare') {
            const rect = canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) / canvas.width;
            if (Math.abs(x - splitX) < 0.02) {
                dragType = 'split';
            } else {
                dragType = 'pan';
            }
        } else {
            dragType = 'pan';
        }

        dragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        dragStartPanX = panX;
        dragStartPanY = panY;
        canvas.style.cursor = dragType === 'split' ? 'col-resize' : 'grabbing';
    }

    function onMouseMove(e) {
        if (!dragging) {
            if (mode === 'compare') {
                const rect = canvas.getBoundingClientRect();
                const x = (e.clientX - rect.left) / canvas.width;
                canvas.style.cursor = Math.abs(x - splitX) < 0.02 ? 'col-resize' : 'grab';
            }
            return;
        }

        if (dragType === 'split') {
            const rect = canvas.getBoundingClientRect();
            splitX = Math.max(0.05, Math.min(0.95, (e.clientX - rect.left) / canvas.width));
            render();
        } else {
            panX = dragStartPanX - (e.clientX - dragStartX);
            panY = dragStartPanY - (e.clientY - dragStartY);
            clampPan();
            render();
        }
    }

    function onMouseUp() {
        dragging = false;
        canvas.style.cursor = (mode === 'compare') ? 'col-resize' : 'grab';
    }

    function onWheel(e) {
        if (!active) return;
        e.preventDefault();
        const delta = e.deltaY > 0 ? -1 : 1;
        setZoom(zoom + delta);
    }

    /* --- タッチイベント --- */
    let lastTouchDist = 0;

    function onTouchStart(e) {
        if (!active) return;
        e.preventDefault();
        if (e.touches.length === 1) {
            dragging = true;

            /* 比較モード: 1本指は常に分割線移動 */
            /* それ以外: 1本指はパン */
            dragType = (mode === 'compare') ? 'split' : 'pan';

            dragStartX = e.touches[0].clientX;
            dragStartY = e.touches[0].clientY;
            dragStartPanX = panX;
            dragStartPanY = panY;
        } else if (e.touches.length === 2) {
            /* 2本指: 比較モードでもパン＆ズーム */
            dragging = true;
            dragType = 'pan';
            const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            dragStartX = cx;
            dragStartY = cy;
            dragStartPanX = panX;
            dragStartPanY = panY;
            lastTouchDist = getTouchDistance(e.touches);
        }
    }

    function onTouchMove(e) {
        if (!active) return;
        e.preventDefault();
        if (e.touches.length === 1 && dragging) {
            if (dragType === 'split') {
                const rect = canvas.getBoundingClientRect();
                splitX = Math.max(0.05, Math.min(0.95, (e.touches[0].clientX - rect.left) / canvas.width));
                render();
            } else {
                panX = dragStartPanX - (e.touches[0].clientX - dragStartX);
                panY = dragStartPanY - (e.touches[0].clientY - dragStartY);
                clampPan();
                render();
            }
        } else if (e.touches.length === 2) {
            /* ピンチズーム */
            const dist = getTouchDistance(e.touches);
            if (lastTouchDist > 0) {
                const ratio = dist / lastTouchDist;
                setZoom(zoom * ratio);
            }
            lastTouchDist = dist;

            /* 2本指パン */
            const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            panX = dragStartPanX - (cx - dragStartX);
            panY = dragStartPanY - (cy - dragStartY);
            clampPan();
            render();
        }
    }

    function onTouchEnd() {
        dragging = false;
        lastTouchDist = 0;
    }

    function getTouchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /* --- ユーティリティ --- */
    function imageDataToCanvas(imageData) {
        const c = document.createElement('canvas');
        c.width = imageData.width;
        c.height = imageData.height;
        c.getContext('2d').putImageData(imageData, 0, 0);
        return c;
    }

    return {
        init, setImages, setConvertedImage, setMode, setZoom,
        getMode, getZoom, render, reset
    };
})();
