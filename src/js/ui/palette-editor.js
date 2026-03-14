/* ========================================
   GAZO98 - パレットエディタUI（98風ダイアログ）
   ======================================== */

const PaletteEditor = (() => {
    const STEP = 17;
    let currentPalette = null;
    let selectedIndex = 0;
    let onSaveCallback = null;
    let liveImageData = null;
    let liveCanvas = null;
    let liveCtx = null;
    let liveUpdateTimer = null;

    function open(palette, onSave, imageData, canvas, ctx) {
        currentPalette = palette.map(c => [...c]);
        selectedIndex = 0;
        onSaveCallback = onSave;
        liveImageData = imageData || null;
        liveCanvas = canvas || null;
        liveCtx = ctx || null;

        const body = buildEditorDOM();

        Dialog.show({
            title: 'パレット編集',
            body,
            buttons: [
                { label: 'OK', value: 'ok' },
                { label: 'Cancel', value: 'cancel' }
            ]
        }).then(result => {
            if (liveUpdateTimer) {
                cancelAnimationFrame(liveUpdateTimer);
                liveUpdateTimer = null;
            }
            if (result === 'ok' && onSaveCallback) {
                onSaveCallback(currentPalette);
            } else if (liveImageData && liveCanvas && liveCtx) {
                /* Cancel時は元画像に戻す */
                onSaveCallback = null;
                renderLivePreview(palette);
            }
        });

        /* 初回ライブプレビュー */
        if (liveImageData) {
            requestLiveUpdate();
        }
    }

    function buildEditorDOM() {
        const container = document.createElement('div');
        container.className = 'palette-editor';

        /* 16色グリッド */
        const grid = document.createElement('div');
        grid.className = 'pe-grid';
        for (let i = 0; i < 16; i++) {
            const cell = document.createElement('div');
            cell.className = 'pe-cell';
            if (i === selectedIndex) cell.classList.add('selected');
            cell.style.background = Palette.toCSS(currentPalette[i]);
            cell.dataset.index = i;
            cell.addEventListener('click', () => selectColor(i, container));
            grid.appendChild(cell);
        }
        container.appendChild(grid);

        /* RGBスライダー */
        const sliders = document.createElement('div');
        sliders.className = 'pe-sliders';

        ['R', 'G', 'B'].forEach((ch, chIdx) => {
            const row = document.createElement('div');
            row.className = 'pe-slider-row';

            const label = document.createElement('span');
            label.className = 'pe-label';
            label.textContent = ch + ':';

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.className = 'pc98-slider pe-range';
            slider.min = 0;
            slider.max = 15;
            slider.value = Math.round(currentPalette[selectedIndex][chIdx] / STEP);
            slider.dataset.channel = chIdx;

            const value = document.createElement('span');
            value.className = 'pe-value';
            value.textContent = slider.value;
            value.id = `pe-val-${chIdx}`;

            slider.addEventListener('input', () => {
                value.textContent = slider.value;
                currentPalette[selectedIndex][chIdx] = parseInt(slider.value) * STEP;
                updateEditorUI(container);
                requestLiveUpdate();
            });

            row.appendChild(label);
            row.appendChild(slider);
            row.appendChild(value);
            sliders.appendChild(row);
        });
        container.appendChild(sliders);

        /* プレビュー色 */
        const preview = document.createElement('div');
        preview.className = 'pe-preview';
        preview.id = 'pe-preview';
        preview.style.background = Palette.toCSS(currentPalette[selectedIndex]);
        container.appendChild(preview);

        /* 一括調整ボタン */
        const bulkRow = document.createElement('div');
        bulkRow.className = 'pe-bulk-row';

        const bulkLabel = document.createElement('span');
        bulkLabel.className = 'pe-bulk-label';
        bulkLabel.textContent = '全色調整:';
        bulkRow.appendChild(bulkLabel);

        const btnBrighter = document.createElement('button');
        btnBrighter.className = 'pc98-button small';
        btnBrighter.textContent = '[ 明るく ]';
        btnBrighter.addEventListener('click', () => {
            shiftAllColors(1);
            updateEditorUI(container);
            requestLiveUpdate();
        });
        bulkRow.appendChild(btnBrighter);

        const btnDarker = document.createElement('button');
        btnDarker.className = 'pc98-button small';
        btnDarker.textContent = '[ 暗く ]';
        btnDarker.addEventListener('click', () => {
            shiftAllColors(-1);
            updateEditorUI(container);
            requestLiveUpdate();
        });
        bulkRow.appendChild(btnDarker);

        const btnContrastUp = document.createElement('button');
        btnContrastUp.className = 'pc98-button small';
        btnContrastUp.textContent = '[ コントラスト+ ]';
        btnContrastUp.addEventListener('click', () => {
            adjustContrast(1);
            updateEditorUI(container);
            requestLiveUpdate();
        });
        bulkRow.appendChild(btnContrastUp);

        const btnContrastDown = document.createElement('button');
        btnContrastDown.className = 'pc98-button small';
        btnContrastDown.textContent = '[ コントラスト- ]';
        btnContrastDown.addEventListener('click', () => {
            adjustContrast(-1);
            updateEditorUI(container);
            requestLiveUpdate();
        });
        bulkRow.appendChild(btnContrastDown);

        container.appendChild(bulkRow);

        return container;
    }

    /* --- ライブプレビュー --- */
    function requestLiveUpdate() {
        if (!liveImageData || !liveCanvas || !liveCtx) return;
        if (liveUpdateTimer) cancelAnimationFrame(liveUpdateTimer);
        liveUpdateTimer = requestAnimationFrame(() => {
            liveUpdateTimer = null;
            renderLivePreview(currentPalette);
        });
    }

    function renderLivePreview(palette) {
        if (!liveImageData || !liveCanvas || !liveCtx) return;
        const result = Palette.applyFlat(liveImageData, palette);
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = result.width;
        tempCanvas.height = result.height;
        tempCanvas.getContext('2d').putImageData(result, 0, 0);

        const areaW = liveCanvas.parentElement.clientWidth;
        const areaH = liveCanvas.parentElement.clientHeight;
        const scale = Math.min(areaW / result.width, areaH / result.height, 1);
        const drawW = Math.floor(result.width * scale);
        const drawH = Math.floor(result.height * scale);

        liveCanvas.width = drawW;
        liveCanvas.height = drawH;
        liveCtx.imageSmoothingEnabled = false;
        liveCtx.drawImage(tempCanvas, 0, 0, drawW, drawH);
    }

    function shiftAllColors(direction) {
        for (let i = 0; i < currentPalette.length; i++) {
            for (let ch = 0; ch < 3; ch++) {
                const val = Math.round(currentPalette[i][ch] / STEP) + direction;
                currentPalette[i][ch] = Math.max(0, Math.min(15, val)) * STEP;
            }
        }
    }

    function adjustContrast(direction) {
        let midSum = 0;
        for (let i = 0; i < currentPalette.length; i++) {
            midSum += (currentPalette[i][0] + currentPalette[i][1] + currentPalette[i][2]) / 3;
        }
        const midPoint = midSum / currentPalette.length / STEP;

        for (let i = 0; i < currentPalette.length; i++) {
            for (let ch = 0; ch < 3; ch++) {
                const val = Math.round(currentPalette[i][ch] / STEP);
                let newVal;
                if (val > midPoint) {
                    newVal = val + direction;
                } else if (val < midPoint) {
                    newVal = val - direction;
                } else {
                    newVal = val;
                }
                currentPalette[i][ch] = Math.max(0, Math.min(15, newVal)) * STEP;
            }
        }
    }

    function selectColor(index, container) {
        selectedIndex = index;
        updateEditorUI(container);
    }

    function updateEditorUI(container) {
        /* セル更新 */
        const cells = container.querySelectorAll('.pe-cell');
        cells.forEach((cell, i) => {
            cell.style.background = Palette.toCSS(currentPalette[i]);
            cell.classList.toggle('selected', i === selectedIndex);
        });

        /* スライダー更新 */
        const sliders = container.querySelectorAll('.pe-range');
        sliders.forEach(slider => {
            const ch = parseInt(slider.dataset.channel);
            const val = Math.round(currentPalette[selectedIndex][ch] / STEP);
            slider.value = val;
            const valEl = container.querySelector(`#pe-val-${ch}`);
            if (valEl) valEl.textContent = val;
        });

        /* プレビュー更新 */
        const preview = container.querySelector('#pe-preview');
        if (preview) {
            preview.style.background = Palette.toCSS(currentPalette[selectedIndex]);
        }
    }

    return { open };
})();
