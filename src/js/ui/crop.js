/* ========================================
   GAZO98 - クロップUI
   8:5固定比率のインタラクティブクロップ
   ======================================== */

const CropUI = (() => {
    const ASPECT = 8 / 5;

    /* 状態 */
    let active = false;
    let sourceImage = null;
    let canvas = null;
    let ctx = null;
    let container = null;

    /* 画像の表示スケール・オフセット */
    let displayScale = 1;
    let imgDisplayX = 0;
    let imgDisplayY = 0;
    let imgDisplayW = 0;
    let imgDisplayH = 0;

    /* クロップ矩形（画像のピクセル座標系） */
    let cropX = 0;
    let cropY = 0;
    let cropW = 0;
    let cropH = 0;

    /* ドラッグ状態 */
    let dragging = false;
    let dragType = 'none'; // 'move' | 'handle-tl' | 'handle-tr' | 'handle-bl' | 'handle-br'
    let dragStartMouseX = 0;
    let dragStartMouseY = 0;
    let dragStartCropX = 0;
    let dragStartCropY = 0;
    let dragStartCropW = 0;
    let dragStartCropH = 0;

    const HANDLE_SIZE = 10;

    let onConfirmCallback = null;
    let onCancelCallback = null;

    function start(img, canvasEl, containerEl, onConfirm, onCancel) {
        sourceImage = img;
        canvas = canvasEl;
        ctx = canvas.getContext('2d');
        container = containerEl;
        onConfirmCallback = onConfirm;
        onCancelCallback = onCancel;
        active = true;

        initCropRect();
        resizeCanvas();
        draw();
        addEventListeners();

        StatusBar.setMessage('クロップ: ドラッグで移動、角をドラッグでリサイズ (8:5固定)');
    }

    function stop() {
        active = false;
        removeEventListeners();
    }

    function initCropRect() {
        const imgW = sourceImage.naturalWidth;
        const imgH = sourceImage.naturalHeight;
        const imgAspect = imgW / imgH;

        if (imgAspect > ASPECT) {
            cropH = imgH;
            cropW = Math.floor(imgH * ASPECT);
            cropX = Math.floor((imgW - cropW) / 2);
            cropY = 0;
        } else {
            cropW = imgW;
            cropH = Math.floor(imgW / ASPECT);
            cropX = 0;
            cropY = Math.floor((imgH - cropH) / 2);
        }
    }

    function resizeCanvas() {
        const areaW = container.clientWidth;
        const cropBarEl = document.getElementById('crop-bar');
        const barH = cropBarEl ? cropBarEl.offsetHeight : 0;
        const areaH = container.clientHeight - barH;
        const imgW = sourceImage.naturalWidth;
        const imgH = sourceImage.naturalHeight;

        canvas.width = areaW;
        canvas.height = areaH;

        displayScale = Math.min(areaW / imgW, areaH / imgH, 1);
        imgDisplayW = Math.floor(imgW * displayScale);
        imgDisplayH = Math.floor(imgH * displayScale);
        imgDisplayX = Math.floor((areaW - imgDisplayW) / 2);
        imgDisplayY = Math.floor((areaH - imgDisplayH) / 2);
    }

    function draw() {
        if (!active) return;

        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        /* 画像描画 */
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sourceImage, imgDisplayX, imgDisplayY, imgDisplayW, imgDisplayH);

        /* クロップ矩形の表示座標 */
        const cx = imgDisplayX + cropX * displayScale;
        const cy = imgDisplayY + cropY * displayScale;
        const cw = cropW * displayScale;
        const ch = cropH * displayScale;

        /* 枠外を半透明黒でオーバーレイ */
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        /* 上 */
        ctx.fillRect(imgDisplayX, imgDisplayY, imgDisplayW, cy - imgDisplayY);
        /* 下 */
        ctx.fillRect(imgDisplayX, cy + ch, imgDisplayW, (imgDisplayY + imgDisplayH) - (cy + ch));
        /* 左 */
        ctx.fillRect(imgDisplayX, cy, cx - imgDisplayX, ch);
        /* 右 */
        ctx.fillRect(cx + cw, cy, (imgDisplayX + imgDisplayW) - (cx + cw), ch);

        /* クロップ枠線 */
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(cx, cy, cw, ch);

        /* 三分割ガイドライン */
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1;
        for (let i = 1; i <= 2; i++) {
            ctx.beginPath();
            ctx.moveTo(cx + cw * i / 3, cy);
            ctx.lineTo(cx + cw * i / 3, cy + ch);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(cx, cy + ch * i / 3);
            ctx.lineTo(cx + cw, cy + ch * i / 3);
            ctx.stroke();
        }

        /* 四隅のハンドル */
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        const hs = HANDLE_SIZE;
        const handles = [
            [cx - hs / 2, cy - hs / 2],
            [cx + cw - hs / 2, cy - hs / 2],
            [cx - hs / 2, cy + ch - hs / 2],
            [cx + cw - hs / 2, cy + ch - hs / 2]
        ];
        handles.forEach(([hx, hy]) => {
            ctx.fillRect(hx, hy, hs, hs);
            ctx.strokeRect(hx, hy, hs, hs);
        });

        /* サイズ表示 */
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(cx, cy + ch + 4, 120, 18);
        ctx.fillStyle = '#fff';
        ctx.font = '12px monospace';
        ctx.fillText(`${cropW} × ${cropH}`, cx + 4, cy + ch + 17);
    }

    /* 表示座標 → 画像ピクセル座標 */
    function displayToImage(mx, my) {
        return {
            x: (mx - imgDisplayX) / displayScale,
            y: (my - imgDisplayY) / displayScale
        };
    }

    function getMousePos(e) {
        const rect = canvas.getBoundingClientRect();
        if (e.touches) {
            return {
                x: e.touches[0].clientX - rect.left,
                y: e.touches[0].clientY - rect.top
            };
        }
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    function hitTest(mx, my) {
        const cx = imgDisplayX + cropX * displayScale;
        const cy = imgDisplayY + cropY * displayScale;
        const cw = cropW * displayScale;
        const ch = cropH * displayScale;
        const hs = HANDLE_SIZE;

        /* ハンドル判定 */
        if (Math.abs(mx - cx) < hs && Math.abs(my - cy) < hs) return 'handle-tl';
        if (Math.abs(mx - (cx + cw)) < hs && Math.abs(my - cy) < hs) return 'handle-tr';
        if (Math.abs(mx - cx) < hs && Math.abs(my - (cy + ch)) < hs) return 'handle-bl';
        if (Math.abs(mx - (cx + cw)) < hs && Math.abs(my - (cy + ch)) < hs) return 'handle-br';

        /* 矩形内判定 */
        if (mx >= cx && mx <= cx + cw && my >= cy && my <= cy + ch) return 'move';

        return 'none';
    }

    function onPointerDown(e) {
        if (!active) return;
        e.preventDefault();
        const pos = getMousePos(e);
        const hit = hitTest(pos.x, pos.y);
        if (hit === 'none') return;

        dragging = true;
        dragType = hit;
        dragStartMouseX = pos.x;
        dragStartMouseY = pos.y;
        dragStartCropX = cropX;
        dragStartCropY = cropY;
        dragStartCropW = cropW;
        dragStartCropH = cropH;
    }

    function onPointerMove(e) {
        if (!active) return;

        const pos = getMousePos(e);

        if (!dragging) {
            const hit = hitTest(pos.x, pos.y);
            if (hit === 'move') {
                canvas.style.cursor = 'move';
            } else if (hit === 'handle-tl' || hit === 'handle-br') {
                canvas.style.cursor = 'nwse-resize';
            } else if (hit === 'handle-tr' || hit === 'handle-bl') {
                canvas.style.cursor = 'nesw-resize';
            } else {
                canvas.style.cursor = 'default';
            }
            return;
        }

        e.preventDefault();
        const dx = (pos.x - dragStartMouseX) / displayScale;
        const dy = (pos.y - dragStartMouseY) / displayScale;
        const imgW = sourceImage.naturalWidth;
        const imgH = sourceImage.naturalHeight;

        if (dragType === 'move') {
            cropX = clamp(dragStartCropX + dx, 0, imgW - cropW);
            cropY = clamp(dragStartCropY + dy, 0, imgH - cropH);
        } else {
            handleResize(dx, dy, imgW, imgH);
        }

        draw();
    }

    function handleResize(dx, dy, imgW, imgH) {
        const MIN_SIZE = 32;
        let newW, newH, newX, newY;

        if (dragType === 'handle-br') {
            newW = Math.max(MIN_SIZE, dragStartCropW + dx);
            newH = Math.round(newW / ASPECT);
            newX = dragStartCropX;
            newY = dragStartCropY;
        } else if (dragType === 'handle-bl') {
            newW = Math.max(MIN_SIZE, dragStartCropW - dx);
            newH = Math.round(newW / ASPECT);
            newX = dragStartCropX + dragStartCropW - newW;
            newY = dragStartCropY;
        } else if (dragType === 'handle-tr') {
            newW = Math.max(MIN_SIZE, dragStartCropW + dx);
            newH = Math.round(newW / ASPECT);
            newX = dragStartCropX;
            newY = dragStartCropY + dragStartCropH - newH;
        } else if (dragType === 'handle-tl') {
            newW = Math.max(MIN_SIZE, dragStartCropW - dx);
            newH = Math.round(newW / ASPECT);
            newX = dragStartCropX + dragStartCropW - newW;
            newY = dragStartCropY + dragStartCropH - newH;
        }

        /* 画像範囲内に制限 */
        if (newX < 0) { newX = 0; newW = dragStartCropX + dragStartCropW; newH = Math.round(newW / ASPECT); }
        if (newY < 0) { newY = 0; newH = dragStartCropY + dragStartCropH; newW = Math.round(newH * ASPECT); }
        if (newX + newW > imgW) { newW = imgW - newX; newH = Math.round(newW / ASPECT); }
        if (newY + newH > imgH) { newH = imgH - newY; newW = Math.round(newH * ASPECT); }

        cropX = Math.round(newX);
        cropY = Math.round(newY);
        cropW = Math.round(newW);
        cropH = Math.round(newH);
    }

    function onPointerUp(e) {
        if (!active) return;
        dragging = false;
        dragType = 'none';
    }

    function onWheel(e) {
        if (!active) return;
        e.preventDefault();

        const delta = e.deltaY > 0 ? -0.05 : 0.05;
        const imgW = sourceImage.naturalWidth;
        const imgH = sourceImage.naturalHeight;

        const centerX = cropX + cropW / 2;
        const centerY = cropY + cropH / 2;

        let newW = cropW * (1 + delta);
        let newH = Math.round(newW / ASPECT);
        newW = Math.round(newW);

        if (newW < 32 || newH < 20) return;
        if (newW > imgW) { newW = imgW; newH = Math.round(newW / ASPECT); }
        if (newH > imgH) { newH = imgH; newW = Math.round(newH * ASPECT); }

        cropX = clamp(Math.round(centerX - newW / 2), 0, imgW - newW);
        cropY = clamp(Math.round(centerY - newH / 2), 0, imgH - newH);
        cropW = newW;
        cropH = newH;

        draw();
    }

    function clamp(val, min, max) {
        return Math.max(min, Math.min(max, val));
    }

    function confirm() {
        if (!active) return;
        const result = { x: Math.round(cropX), y: Math.round(cropY), w: Math.round(cropW), h: Math.round(cropH) };
        stop();
        if (onConfirmCallback) onConfirmCallback(result);
    }

    function cancel() {
        if (!active) return;
        stop();
        if (onCancelCallback) onCancelCallback();
    }

    /* イベントリスナー管理 */
    let boundDown, boundMove, boundUp, boundWheel, boundTouchStart, boundTouchMove, boundTouchEnd, boundResize;

    function addEventListeners() {
        boundDown = onPointerDown.bind(null);
        boundMove = onPointerMove.bind(null);
        boundUp = onPointerUp.bind(null);
        boundWheel = onWheel.bind(null);
        boundTouchStart = (e) => onPointerDown(e);
        boundTouchMove = (e) => onPointerMove(e);
        boundTouchEnd = (e) => onPointerUp(e);
        boundResize = () => { resizeCanvas(); draw(); };

        canvas.addEventListener('mousedown', boundDown);
        window.addEventListener('mousemove', boundMove);
        window.addEventListener('mouseup', boundUp);
        canvas.addEventListener('wheel', boundWheel, { passive: false });
        canvas.addEventListener('touchstart', boundTouchStart, { passive: false });
        canvas.addEventListener('touchmove', boundTouchMove, { passive: false });
        canvas.addEventListener('touchend', boundTouchEnd);
        window.addEventListener('resize', boundResize);
    }

    function removeEventListeners() {
        canvas.removeEventListener('mousedown', boundDown);
        window.removeEventListener('mousemove', boundMove);
        window.removeEventListener('mouseup', boundUp);
        canvas.removeEventListener('wheel', boundWheel);
        canvas.removeEventListener('touchstart', boundTouchStart);
        canvas.removeEventListener('touchmove', boundTouchMove);
        canvas.removeEventListener('touchend', boundTouchEnd);
        window.removeEventListener('resize', boundResize);
        canvas.style.cursor = 'default';
    }

    function isActive() {
        return active;
    }

    return { start, stop, confirm, cancel, isActive, draw };
})();
