/* ========================================
   GAZO98 - アプリケーション エントリポイント
   ======================================== */

const App = (() => {
    /* PC-9801 定数 */
    const PC98 = {
        COLOR_STEP: 17,
        COLORS_PER_CHANNEL: 16,
        TOTAL_COLORS: 4096,
        PALETTE_SIZE: 16,
        STANDARD_WIDTH: 640,
        STANDARD_HEIGHT: 400,
        ASPECT_RATIO: 8 / 5
    };

    /* 解像度テーブル */
    const RESOLUTIONS = {
        '640x400': { w: 640, h: 400 },
        '640x200': { w: 640, h: 200 },
        '320x200': { w: 320, h: 200 },
        'keep': null
    };

    /* 状態管理 */
    const state = {
        originalImage: null,
        croppedImage: null,   // クロップ＆リサイズ済みImageData
        convertedImage: null, // 減色済みImageData
        currentPalette: null, // 現在の16色パレット
        fileName: null,
        imageLoaded: false,
        phase: 'idle'  // 'idle' | 'crop' | 'ready' | 'converting' | 'done'
    };

    /* DOM参照 */
    let previewCanvas = null;
    let previewCtx = null;
    let dropZone = null;
    let previewArea = null;
    let cropBar = null;
    let controlPanel = null;
    let resolutionSelect = null;
    let paletteFileInput = null;

    function init() {
        previewCanvas = document.getElementById('preview-canvas');
        previewCtx = previewCanvas.getContext('2d');
        dropZone = document.getElementById('drop-zone');
        previewArea = document.getElementById('preview-area');
        cropBar = document.getElementById('crop-bar');
        controlPanel = document.getElementById('control-panel');
        resolutionSelect = document.getElementById('resolution-select');
        paletteFileInput = document.getElementById('palette-file-input');

        Menu.init();
        Dialog.init();
        StatusBar.init();
        FileLoader.init(onImageLoaded);

        setupMenuActions();
        setupButtons();
        initPaletteDisplay();

        StatusBar.setMessage('Ready - 画像をドラッグ＆ドロップしてください');
    }

    function setupMenuActions() {
        /* ファイルメニュー */
        Menu.on('open', () => FileLoader.openDialog());
        Menu.on('close', () => closeImage());

        /* 変換メニュー */
        Menu.on('recrop', () => startCrop());
        Menu.on('convert', () => runConvert());
        Menu.on('reset', () => resetConvert());

        /* パレットメニュー */
        Menu.on('palette-auto', () => autoPalette());
        Menu.on('palette-auto-skin', () => autoPaletteSkinBias());
        Menu.on('palette-preset', () => showPresetDialog());
        Menu.on('palette-edit', () => editPalette());
        Menu.on('palette-import', () => importPalette());
        Menu.on('palette-export', () => exportPalette());
    }

    function setupButtons() {
        const btnOpen = document.getElementById('btn-open');
        if (btnOpen) {
            btnOpen.addEventListener('click', (e) => {
                e.stopPropagation();
                FileLoader.openDialog();
            });
        }

        document.getElementById('btn-crop-confirm').addEventListener('click', () => CropUI.confirm());
        document.getElementById('btn-crop-cancel').addEventListener('click', () => CropUI.cancel());

        const btnConvert = document.getElementById('btn-convert');
        if (btnConvert) {
            btnConvert.addEventListener('click', () => runConvert());
        }

        const btnPaletteEdit = document.getElementById('btn-palette-edit');
        if (btnPaletteEdit) {
            btnPaletteEdit.addEventListener('click', () => editPalette());
        }

        const ditherStrength = document.getElementById('dither-strength');
        const ditherStrengthValue = document.getElementById('dither-strength-value');
        if (ditherStrength && ditherStrengthValue) {
            ditherStrength.addEventListener('input', () => {
                ditherStrengthValue.textContent = ditherStrength.value + '%';
            });
        }

        /* パレットJSONインポート用 */
        if (paletteFileInput) {
            paletteFileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                    try {
                        const palette = Palette.importJSON(reader.result);
                        setPalette(palette);
                        StatusBar.setMessage('パレットをインポートしました');
                    } catch (err) {
                        Dialog.alert('エラー', 'パレットファイルの読み込みに失敗しました: ' + err.message);
                    }
                };
                reader.readAsText(file);
                paletteFileInput.value = '';
            });
        }
    }

    function initPaletteDisplay() {
        const paletteDisplay = document.getElementById('palette-display');
        if (!paletteDisplay) return;

        paletteDisplay.innerHTML = '';
        for (let i = 0; i < PC98.PALETTE_SIZE; i++) {
            const cell = document.createElement('div');
            cell.className = 'palette-cell';
            cell.style.background = '#000';
            paletteDisplay.appendChild(cell);
        }
    }

    /* --- パレット状態管理 --- */
    function setPalette(palette) {
        state.currentPalette = palette;
        updatePaletteDisplay();
        enablePaletteControls();
    }

    function updatePaletteDisplay() {
        const cells = document.querySelectorAll('#palette-display .palette-cell');
        if (!state.currentPalette) return;
        cells.forEach((cell, i) => {
            if (i < state.currentPalette.length) {
                cell.style.background = Palette.toCSS(state.currentPalette[i]);
            }
        });
    }

    function enablePaletteControls() {
        Menu.enableEntry('palette-edit');
        Menu.enableEntry('palette-export');
        Menu.enableEntry('convert');

        const btnPaletteEdit = document.getElementById('btn-palette-edit');
        if (btnPaletteEdit) {
            btnPaletteEdit.classList.remove('disabled');
            btnPaletteEdit.disabled = false;
        }

        const btnConvert = document.getElementById('btn-convert');
        if (btnConvert) {
            btnConvert.classList.remove('disabled');
            btnConvert.disabled = false;
        }
    }

    function enableReadyControls() {
        Menu.enableEntry('palette-auto');
        Menu.enableEntry('palette-auto-skin');
        Menu.enableEntry('palette-preset');
        Menu.enableEntry('palette-import');
        Menu.enableEntry('recrop');
    }

    /* --- パレットメニュー操作 --- */
    function autoPalette() {
        if (!state.croppedImage) return;

        StatusBar.setMessage('パレット自動生成中...');
        const palette = Palette.medianCut(state.croppedImage);
        setPalette(palette);
        StatusBar.setMessage('パレット自動生成完了（メディアンカット法）');
    }

    function autoPaletteSkinBias() {
        if (!state.croppedImage) return;

        StatusBar.setMessage('パレット自動生成中（肌感重視）...');
        const palette = Palette.medianCutSkinBias(state.croppedImage);
        setPalette(palette);
        StatusBar.setMessage('パレット自動生成完了（肌感重視メディアンカット）');
    }

    function showPresetDialog() {
        const presets = Palette.getPresetList();

        const container = document.createElement('div');

        const list = document.createElement('div');
        list.className = 'preset-list';

        let selectedKey = 'default';

        presets.forEach(preset => {
            const item = document.createElement('div');
            item.className = 'preset-item';
            if (preset.key === selectedKey) item.classList.add('selected');

            const nameSpan = document.createElement('span');
            nameSpan.textContent = preset.name;

            /* プレビュー色チップ */
            const colorsDiv = document.createElement('div');
            colorsDiv.className = 'preset-colors';
            const presetColors = Palette.getPreset(preset.key);
            presetColors.slice(0, 8).forEach(c => {
                const chip = document.createElement('div');
                chip.className = 'preset-color-chip';
                chip.style.background = Palette.toCSS(c);
                colorsDiv.appendChild(chip);
            });

            item.appendChild(nameSpan);
            item.appendChild(colorsDiv);

            item.addEventListener('click', () => {
                list.querySelectorAll('.preset-item').forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');
                selectedKey = preset.key;
            });

            list.appendChild(item);
        });

        container.appendChild(list);

        Dialog.show({
            title: 'プリセットパレット選択',
            body: container,
            buttons: [
                { label: 'OK', value: 'ok' },
                { label: 'Cancel', value: 'cancel' }
            ]
        }).then(result => {
            if (result === 'ok') {
                const palette = Palette.getPreset(selectedKey);
                if (palette) {
                    setPalette(palette);
                    StatusBar.setMessage(`プリセット「${presets.find(p => p.key === selectedKey).name}」を適用しました`);
                }
            }
        });
    }

    function editPalette() {
        if (!state.currentPalette) return;
        PaletteEditor.open(
            state.currentPalette,
            (newPalette) => {
                setPalette(newPalette);
                StatusBar.setMessage('パレットを更新しました');
            },
            state.croppedImage,
            previewCanvas,
            previewCtx
        );
    }

    function importPalette() {
        if (paletteFileInput) {
            paletteFileInput.click();
        }
    }

    function exportPalette() {
        if (!state.currentPalette) return;

        const json = Palette.exportJSON(state.currentPalette);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = (state.fileName ? state.fileName.replace(/\.[^.]+$/, '') : 'palette') + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        StatusBar.setMessage('パレットをエクスポートしました');
    }

    /* --- 変換実行 --- */
    function runConvert() {
        if (!state.croppedImage || !state.currentPalette) {
            Dialog.alert('変換エラー', 'クロップ済み画像とパレットが必要です。');
            return;
        }

        state.phase = 'converting';
        StatusBar.setMessage('変換中...');

        /* 現時点ではベタ減色（ディザなし）で変換 */
        const result = Palette.applyFlat(state.croppedImage, state.currentPalette);
        state.convertedImage = result;
        state.phase = 'done';

        /* 結果をプレビュー */
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = result.width;
        tempCanvas.height = result.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.putImageData(result, 0, 0);

        previewCanvas.className = 'preview-mode';
        drawCroppedPreview(tempCanvas);

        Menu.enableEntry('reset');
        StatusBar.setColors(state.currentPalette.length);
        StatusBar.setMessage(`変換完了: ${result.width}×${result.height} / ${state.currentPalette.length}色`);
    }

    function resetConvert() {
        if (!state.croppedImage) return;

        state.convertedImage = null;
        state.phase = 'ready';

        /* クロップ済み画像に戻す */
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = state.croppedImage.width;
        tempCanvas.height = state.croppedImage.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.putImageData(state.croppedImage, 0, 0);

        previewCanvas.className = 'preview-mode';
        drawCroppedPreview(tempCanvas);

        Menu.disableEntry('reset');
        StatusBar.setMessage('リセットしました - パラメータを調整してください');
    }

    /* --- 画像読み込み → クロップ開始 --- */
    function onImageLoaded(img, fileName) {
        state.originalImage = img;
        state.fileName = fileName;
        state.imageLoaded = true;

        Menu.enableEntry('close');
        StatusBar.setResolution(img.naturalWidth, img.naturalHeight);
        StatusBar.setMessage(`読み込み完了: ${fileName} (${img.naturalWidth}×${img.naturalHeight})`);

        startCrop();
    }

    function startCrop() {
        if (!state.originalImage) return;

        state.phase = 'crop';

        dropZone.style.display = 'none';
        previewCanvas.style.display = 'block';
        previewCanvas.className = 'crop-mode';
        cropBar.style.display = 'block';
        controlPanel.style.display = 'none';

        CropUI.start(
            state.originalImage,
            previewCanvas,
            previewArea,
            onCropConfirm,
            onCropCancel
        );
    }

    function onCropConfirm(cropRect) {
        cropBar.style.display = 'none';

        const resolution = resolutionSelect.value;
        const resInfo = RESOLUTIONS[resolution];

        let outW, outH;
        if (resInfo) {
            outW = resInfo.w;
            outH = resInfo.h;
        } else {
            outW = cropRect.w;
            outH = cropRect.h;
        }

        /* クロップ＆リサイズ */
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = outW;
        tempCanvas.height = outH;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.imageSmoothingEnabled = true;
        tempCtx.imageSmoothingQuality = 'high';
        tempCtx.drawImage(
            state.originalImage,
            cropRect.x, cropRect.y, cropRect.w, cropRect.h,
            0, 0, outW, outH
        );

        state.croppedImage = tempCtx.getImageData(0, 0, outW, outH);
        state.convertedImage = null;
        state.currentPalette = null;
        state.phase = 'ready';

        /* クロップ結果をプレビュー表示 */
        previewCanvas.className = 'preview-mode';
        drawCroppedPreview(tempCanvas);

        controlPanel.style.display = 'flex';

        enableReadyControls();
        initPaletteDisplay();
        StatusBar.setResolution(outW, outH);
        StatusBar.setMessage(`クロップ完了: ${outW}×${outH} - パレットを選択してください`);
    }

    function onCropCancel() {
        cropBar.style.display = 'none';

        if (state.croppedImage) {
            /* 前のクロップ結果に戻る */
            state.phase = 'ready';
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = state.croppedImage.width;
            tempCanvas.height = state.croppedImage.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.putImageData(state.croppedImage, 0, 0);
            drawCroppedPreview(tempCanvas);
            controlPanel.style.display = 'flex';
        } else {
            /* クロップ前 → 閉じる */
            closeImage();
        }
    }

    function drawCroppedPreview(sourceCanvas) {
        const areaW = previewArea.clientWidth;
        const areaH = previewArea.clientHeight;
        const imgW = sourceCanvas.width;
        const imgH = sourceCanvas.height;

        const scale = Math.min(areaW / imgW, areaH / imgH, 1);
        const drawW = Math.floor(imgW * scale);
        const drawH = Math.floor(imgH * scale);

        previewCanvas.width = drawW;
        previewCanvas.height = drawH;
        previewCtx.imageSmoothingEnabled = false;
        previewCtx.drawImage(sourceCanvas, 0, 0, drawW, drawH);
    }

    function closeImage() {
        if (CropUI.isActive()) {
            CropUI.stop();
        }

        state.originalImage = null;
        state.croppedImage = null;
        state.convertedImage = null;
        state.currentPalette = null;
        state.fileName = null;
        state.imageLoaded = false;
        state.phase = 'idle';

        previewCanvas.style.display = 'none';
        cropBar.style.display = 'none';
        controlPanel.style.display = 'flex';
        dropZone.style.display = 'flex';

        previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

        initPaletteDisplay();

        StatusBar.setResolution(null, null);
        StatusBar.setMessage('Ready - 画像をドラッグ＆ドロップしてください');

        Menu.disableEntry('close');
        Menu.disableEntry('recrop');
        Menu.disableEntry('convert');
        Menu.disableEntry('reset');
        Menu.disableEntry('palette-auto');
        Menu.disableEntry('palette-auto-skin');
        Menu.disableEntry('palette-preset');
        Menu.disableEntry('palette-edit');
        Menu.disableEntry('palette-import');
        Menu.disableEntry('palette-export');

        const btnConvert = document.getElementById('btn-convert');
        if (btnConvert) {
            btnConvert.classList.add('disabled');
            btnConvert.disabled = true;
        }
        const btnPaletteEdit = document.getElementById('btn-palette-edit');
        if (btnPaletteEdit) {
            btnPaletteEdit.classList.add('disabled');
            btnPaletteEdit.disabled = true;
        }
    }

    return { init, PC98, state };
})();

/* DOMContentLoaded で初期化 */
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
