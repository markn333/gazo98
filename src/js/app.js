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
        phase: 'idle',  // 'idle' | 'crop' | 'ready' | 'converting' | 'done'
        skinMask: null,       // 肌色マスク（Uint8Array）
        skinDetectParams: { ...SkinDetect.DEFAULT_PARAMS },
        maskPreviewActive: false
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

    /* Web Worker */
    let worker = null;

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
        initWorker();

        setupMenuActions();
        setupButtons();
        setupSkinControls();
        setupEffectControls();
        Preview.init(previewCanvas, previewArea);
        initPaletteDisplay();

        StatusBar.setMessage('Ready - 画像をドラッグ＆ドロップしてください');
    }

    function setupMenuActions() {
        /* ファイルメニュー */
        Menu.on('open', () => FileLoader.openDialog());
        Menu.on('save-png', () => savePNG());
        Menu.on('save-bmp', () => saveBMP());
        Menu.on('save-mag', () => saveMAG());
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

        /* 表示メニュー */
        Menu.on('view-original', () => setViewMode('original'));
        Menu.on('view-converted', () => setViewMode('converted'));
        Menu.on('view-compare', () => setViewMode('compare'));
        Menu.on('view-zoom', () => cycleZoom());
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

    /* --- Web Worker 初期化 --- */
    function initWorker() {
        worker = new Worker('js/worker/convert-worker.js');
        worker.onmessage = function(e) {
            const msg = e.data;
            switch (msg.type) {
                case 'progress':
                    StatusBar.setMessage(`処理中... ${msg.phase} ${msg.percent}%`);
                    break;
                case 'palette-result':
                    onWorkerPaletteResult(msg.palette);
                    break;
                case 'convert-result':
                    onWorkerConvertResult(msg);
                    break;
                case 'mask-result':
                    onWorkerMaskResult(msg);
                    break;
            }
        };
        worker.onerror = function(err) {
            StatusBar.setMessage('Worker エラー: ' + err.message);
            state.phase = 'ready';
        };
    }

    function onWorkerPaletteResult(palette) {
        setPalette(palette);
        StatusBar.setMessage('パレット自動生成完了');
    }

    function onWorkerConvertResult(msg) {
        const imageData = new ImageData(
            new Uint8ClampedArray(msg.data),
            msg.width,
            msg.height
        );
        state.convertedImage = imageData;
        state.phase = 'done';

        /* Previewに原画像と変換後画像をセット */
        Preview.setImages(state.croppedImage, imageData);
        previewCanvas.className = 'preview-mode';

        /* エフェクトが有効なら適用して表示 */
        applyEffectsAndShow();

        Menu.enableEntry('reset');
        Menu.enableEntry('save-png');
        Menu.enableEntry('save-bmp');
        Menu.enableEntry('save-mag');
        Menu.enableEntry('view-original');
        Menu.enableEntry('view-converted');
        Menu.enableEntry('view-compare');
        Menu.enableEntry('view-zoom');
        enableEffectControls();
        StatusBar.setColors(state.currentPalette.length);
        StatusBar.setMessage(`変換完了: ${imageData.width}×${imageData.height} / ${state.currentPalette.length}色`);
    }

    function onWorkerMaskResult(msg) {
        state.skinMask = new Uint8Array(msg.mask);
        const ratio = ((msg.skinPixelCount / msg.totalPixels) * 100).toFixed(1);
        StatusBar.setMessage(`肌色検出: ${msg.skinPixelCount}px (${ratio}%)`);

        if (state.maskPreviewActive) {
            showMaskOverlay();
        }
    }

    /* --- 肌感改善UI制御 --- */
    function setupSkinControls() {
        const skinMode = document.getElementById('skin-mode');
        const skinWeight = document.getElementById('skin-weight');
        const skinWeightValue = document.getElementById('skin-weight-value');
        const skinMinColors = document.getElementById('skin-min-colors');
        const skinSplitMode = document.getElementById('skin-split-mode');
        const skinPaletteCount = document.getElementById('skin-palette-count');
        const skinPaletteCountValue = document.getElementById('skin-palette-count-value');
        const skinDitherEnable = document.getElementById('skin-dither-enable');
        const skinDitherPattern = document.getElementById('skin-dither-pattern');
        const skinBlendWidth = document.getElementById('skin-blend-width');
        const skinBlendWidthValue = document.getElementById('skin-blend-width-value');
        const btnMaskPreview = document.getElementById('btn-mask-preview');
        const btnSkinDetectSettings = document.getElementById('btn-skin-detect-settings');

        /* モード切替 */
        skinMode.addEventListener('change', () => {
            const mode = skinMode.value;
            document.getElementById('skin-weight-settings').style.display = mode === 'weight' ? '' : 'none';
            document.getElementById('skin-separate-settings').style.display = mode === 'separate' ? '' : 'none';

            /* モード変更時にパレット再生成 */
            if (state.croppedImage && mode !== 'off') {
                generateSkinPalette();
            }
        });

        /* 重みスライダー */
        skinWeight.addEventListener('input', () => {
            skinWeightValue.textContent = (skinWeight.value / 10).toFixed(1);
        });

        /* 領域分離: 配分方式 */
        skinSplitMode.addEventListener('change', () => {
            document.getElementById('skin-palette-count-row').style.display =
                skinSplitMode.value === 'manual' ? '' : 'none';
        });

        /* 肌色枠数スライダー */
        skinPaletteCount.addEventListener('input', () => {
            skinPaletteCountValue.textContent = skinPaletteCount.value + '色';
        });

        /* 肌専用ディザ */
        skinDitherEnable.addEventListener('change', () => {
            document.getElementById('skin-dither-settings').style.display =
                skinDitherEnable.checked ? '' : 'none';
        });

        /* ブレンド幅 */
        skinBlendWidth.addEventListener('input', () => {
            skinBlendWidthValue.textContent = skinBlendWidth.value + 'px';
        });

        /* マスク確認 */
        btnMaskPreview.addEventListener('click', () => {
            if (state.maskPreviewActive) {
                hideMaskOverlay();
            } else {
                requestMaskPreview();
            }
        });

        /* 検出設定ダイアログ */
        btnSkinDetectSettings.addEventListener('click', () => {
            showSkinDetectDialog();
        });
    }

    function enableSkinControls() {
        document.getElementById('skin-mode').disabled = false;
        document.getElementById('skin-dither-enable').disabled = false;
        document.getElementById('btn-mask-preview').disabled = false;
        document.getElementById('btn-skin-detect-settings').disabled = false;
    }

    function generateSkinPalette() {
        if (!state.croppedImage) return;

        const skinMode = document.getElementById('skin-mode').value;
        const img = state.croppedImage;

        if (skinMode === 'weight') {
            const skinWeight = document.getElementById('skin-weight').value / 10;
            const minSkinColors = parseInt(document.getElementById('skin-min-colors').value);

            StatusBar.setMessage('肌色優先パレット生成中...');
            worker.postMessage({
                type: 'median-cut-weighted',
                data: img.data,
                totalPixels: img.width * img.height,
                numColors: PC98.PALETTE_SIZE,
                skinWeight: skinWeight,
                minSkinColors: minSkinColors,
                detectParams: state.skinDetectParams
            });
        } else if (skinMode === 'separate') {
            const splitMode = document.getElementById('skin-split-mode').value;
            const skinPaletteCount = parseInt(document.getElementById('skin-palette-count').value);

            StatusBar.setMessage('領域分離パレット生成中...');
            worker.postMessage({
                type: 'median-cut-separate',
                data: img.data,
                width: img.width,
                height: img.height,
                numColors: PC98.PALETTE_SIZE,
                splitMode: splitMode,
                skinPaletteCount: skinPaletteCount,
                detectParams: state.skinDetectParams
            });
        }
    }

    function requestMaskPreview() {
        if (!state.croppedImage) return;

        StatusBar.setMessage('肌色マスク生成中...');
        const img = state.croppedImage;
        worker.postMessage({
            type: 'generate-mask',
            data: img.data,
            width: img.width,
            height: img.height,
            detectParams: state.skinDetectParams
        });
        state.maskPreviewActive = true;
        document.getElementById('btn-mask-preview').textContent = '[ マスク解除 ]';
    }

    function showMaskOverlay() {
        if (!state.croppedImage || !state.skinMask) return;

        const w = state.croppedImage.width;
        const h = state.croppedImage.height;

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = w;
        tempCanvas.height = h;
        const tempCtx = tempCanvas.getContext('2d');

        /* ベース画像を描画 */
        tempCtx.putImageData(state.convertedImage || state.croppedImage, 0, 0);

        /* マスクオーバーレイを描画 */
        const overlay = SkinDetect.createOverlay(state.skinMask, w, h);
        const overlayCanvas = document.createElement('canvas');
        overlayCanvas.width = w;
        overlayCanvas.height = h;
        const overlayCtx = overlayCanvas.getContext('2d');
        overlayCtx.putImageData(overlay, 0, 0);
        tempCtx.drawImage(overlayCanvas, 0, 0);

        previewCanvas.className = 'preview-mode';
        drawCroppedPreview(tempCanvas);
    }

    function hideMaskOverlay() {
        state.maskPreviewActive = false;
        document.getElementById('btn-mask-preview').textContent = '[ マスク確認 ]';

        if (!state.croppedImage) return;

        /* 元画像に戻す */
        const src = state.convertedImage || state.croppedImage;
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = src.width;
        tempCanvas.height = src.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.putImageData(src, 0, 0);
        previewCanvas.className = 'preview-mode';
        drawCroppedPreview(tempCanvas);
    }

    function showSkinDetectDialog() {
        const p = state.skinDetectParams;
        const container = document.createElement('div');
        container.innerHTML = `
            <div class="param-row"><label>H min:</label>
                <div class="slider-container">
                    <input type="range" class="pc98-slider" id="sd-hmin" min="0" max="60" value="${p.hMin}">
                    <span class="slider-value" id="sd-hmin-v">${p.hMin}°</span>
                </div></div>
            <div class="param-row"><label>H max:</label>
                <div class="slider-container">
                    <input type="range" class="pc98-slider" id="sd-hmax" min="0" max="90" value="${p.hMax}">
                    <span class="slider-value" id="sd-hmax-v">${p.hMax}°</span>
                </div></div>
            <div class="param-row"><label>S min:</label>
                <div class="slider-container">
                    <input type="range" class="pc98-slider" id="sd-smin" min="0" max="100" value="${Math.round(p.sMin * 100)}">
                    <span class="slider-value" id="sd-smin-v">${p.sMin.toFixed(2)}</span>
                </div></div>
            <div class="param-row"><label>S max:</label>
                <div class="slider-container">
                    <input type="range" class="pc98-slider" id="sd-smax" min="0" max="100" value="${Math.round(p.sMax * 100)}">
                    <span class="slider-value" id="sd-smax-v">${p.sMax.toFixed(2)}</span>
                </div></div>
            <div class="param-row"><label>V min:</label>
                <div class="slider-container">
                    <input type="range" class="pc98-slider" id="sd-vmin" min="0" max="100" value="${Math.round(p.vMin * 100)}">
                    <span class="slider-value" id="sd-vmin-v">${p.vMin.toFixed(2)}</span>
                </div></div>
            <div class="param-row"><label>V max:</label>
                <div class="slider-container">
                    <input type="range" class="pc98-slider" id="sd-vmax" min="0" max="100" value="${Math.round(p.vMax * 100)}">
                    <span class="slider-value" id="sd-vmax-v">${p.vMax.toFixed(2)}</span>
                </div></div>
        `;

        /* スライダーのリアルタイム更新 */
        const bindSlider = (id, suffix, fmt) => {
            const el = container.querySelector('#' + id);
            const vEl = container.querySelector('#' + id + '-v');
            el.addEventListener('input', () => { vEl.textContent = fmt(el.value); });
        };
        bindSlider('sd-hmin', 'v', v => v + '°');
        bindSlider('sd-hmax', 'v', v => v + '°');
        bindSlider('sd-smin', 'v', v => (v / 100).toFixed(2));
        bindSlider('sd-smax', 'v', v => (v / 100).toFixed(2));
        bindSlider('sd-vmin', 'v', v => (v / 100).toFixed(2));
        bindSlider('sd-vmax', 'v', v => (v / 100).toFixed(2));

        Dialog.show({
            title: '肌色検出パラメータ',
            body: container,
            buttons: [
                { label: 'OK', value: 'ok' },
                { label: 'デフォルト', value: 'default' },
                { label: 'Cancel', value: 'cancel' }
            ]
        }).then(result => {
            if (result === 'ok') {
                state.skinDetectParams = {
                    hMin: parseInt(container.querySelector('#sd-hmin').value),
                    hMax: parseInt(container.querySelector('#sd-hmax').value),
                    sMin: parseInt(container.querySelector('#sd-smin').value) / 100,
                    sMax: parseInt(container.querySelector('#sd-smax').value) / 100,
                    vMin: parseInt(container.querySelector('#sd-vmin').value) / 100,
                    vMax: parseInt(container.querySelector('#sd-vmax').value) / 100
                };
                state.skinMask = null;
                StatusBar.setMessage('肌色検出パラメータを更新しました');
            } else if (result === 'default') {
                state.skinDetectParams = { ...SkinDetect.DEFAULT_PARAMS };
                state.skinMask = null;
                StatusBar.setMessage('肌色検出パラメータをデフォルトに戻しました');
            }
        });
    }

    function getSkinOptions() {
        const skinMode = document.getElementById('skin-mode').value;
        const skinDitherEnable = document.getElementById('skin-dither-enable').checked;

        /* モードOFFかつディザも無効なら不要 */
        if (skinMode === 'off' && !skinDitherEnable) return null;

        return {
            mode: skinMode,
            detectParams: state.skinDetectParams,
            skinDither: {
                enabled: skinDitherEnable,
                pattern: document.getElementById('skin-dither-pattern').value,
                blendWidth: parseInt(document.getElementById('skin-blend-width').value)
            }
        };
    }

    /* --- エフェクトUI制御 --- */
    function setupEffectControls() {
        const scanline = document.getElementById('effect-scanline');
        const crt = document.getElementById('effect-crt');
        const sharp = document.getElementById('effect-sharp');

        const onEffectChange = () => {
            if (state.convertedImage) applyEffectsAndShow();
        };

        if (scanline) scanline.addEventListener('change', onEffectChange);
        if (crt) crt.addEventListener('change', onEffectChange);
        if (sharp) sharp.addEventListener('change', onEffectChange);
    }

    function enableEffectControls() {
        document.getElementById('effect-scanline').disabled = false;
        document.getElementById('effect-crt').disabled = false;
        document.getElementById('effect-sharp').disabled = false;
    }

    function getEffectOptions() {
        return {
            scanline: { enabled: document.getElementById('effect-scanline').checked, strength: 50 },
            crt: { enabled: document.getElementById('effect-crt').checked, strength: 50 },
            sharp: { enabled: document.getElementById('effect-sharp').checked, strength: 50 }
        };
    }

    function applyEffectsAndShow() {
        if (!state.convertedImage) return;

        const effects = getEffectOptions();
        const hasEffect = effects.scanline.enabled || effects.crt.enabled || effects.sharp.enabled;

        let displayImage;
        if (hasEffect) {
            displayImage = PostEffect.apply(state.convertedImage, effects);
        } else {
            displayImage = state.convertedImage;
        }

        Preview.setConvertedImage(displayImage);
        Preview.render();
    }

    /* --- プレビューモード制御 --- */
    function setViewMode(newMode) {
        Preview.setMode(newMode);
        StatusBar.setMessage(
            newMode === 'original' ? '表示: 原画像' :
            newMode === 'converted' ? '表示: 変換後' :
            '表示: スワイプ比較（ドラッグで分割位置を移動）'
        );
    }

    function cycleZoom() {
        const current = Preview.getZoom();
        const next = current >= 4 ? 1 : current * 2;
        Preview.setZoom(next);
        StatusBar.setMessage(`ズーム: ${next}x`);
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

        /* ディザUIを有効化 */
        const ditherSelect = document.getElementById('dither-select');
        const ditherStrength = document.getElementById('dither-strength');
        if (ditherSelect) ditherSelect.disabled = false;
        if (ditherStrength) ditherStrength.disabled = false;

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
        enableSkinControls();
    }

    /* --- パレットメニュー操作 --- */
    function autoPalette() {
        if (!state.croppedImage) return;

        StatusBar.setMessage('パレット自動生成中...');
        const img = state.croppedImage;
        worker.postMessage({
            type: 'median-cut',
            data: img.data,
            totalPixels: img.width * img.height,
            numColors: PC98.PALETTE_SIZE
        });
    }

    function autoPaletteSkinBias() {
        if (!state.croppedImage) return;

        StatusBar.setMessage('パレット自動生成中（肌感重視）...');
        const img = state.croppedImage;
        worker.postMessage({
            type: 'median-cut-skin',
            data: img.data,
            totalPixels: img.width * img.height,
            numColors: PC98.PALETTE_SIZE
        });
    }

    function showPresetDialog() {
        const presets = Palette.getPresetList();

        const container = document.createElement('div');

        const list = document.createElement('div');
        list.className = 'preset-list';

        let selectedKey = 'default';

        /* カテゴリ別に表示 */
        const categories = [
            { key: 'general', label: '─ 汎用 ─' },
            { key: 'eroge', label: '─ エロゲ風 ─' }
        ];

        categories.forEach(cat => {
            const catPresets = presets.filter(p => p.category === cat.key);
            if (catPresets.length === 0) return;

            const catLabel = document.createElement('div');
            catLabel.className = 'preset-category';
            catLabel.textContent = cat.label;
            list.appendChild(catLabel);

            catPresets.forEach(preset => {
                const item = document.createElement('div');
                item.className = 'preset-item';
                if (preset.key === selectedKey) item.classList.add('selected');

                const nameSpan = document.createElement('span');
                nameSpan.textContent = preset.name;

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
        });

        container.appendChild(list);

        /* 自動微調整チェックボックス */
        const adjustRow = document.createElement('div');
        adjustRow.className = 'param-row';
        adjustRow.style.marginTop = '8px';
        adjustRow.style.borderTop = '1px solid #c0c0c0';
        adjustRow.style.paddingTop = '6px';
        adjustRow.innerHTML = `
            <label class="pc98-checkbox">
                <input type="checkbox" id="preset-auto-adjust">
                <span>非肌色枠を画像に合わせて自動調整</span>
            </label>
        `;
        container.appendChild(adjustRow);

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
                const autoAdjust = container.querySelector('#preset-auto-adjust').checked;
                if (palette) {
                    if (autoAdjust && state.croppedImage) {
                        /* プリセットベース＋自動微調整 */
                        setPalette(palette); // 一旦プリセットを表示
                        StatusBar.setMessage('プリセット微調整中...');
                        const img = state.croppedImage;
                        worker.postMessage({
                            type: 'preset-adjust',
                            data: img.data,
                            totalPixels: img.width * img.height,
                            presetPalette: palette,
                            detectParams: state.skinDetectParams
                        });
                    } else {
                        setPalette(palette);
                        StatusBar.setMessage(`プリセット「${presets.find(p => p.key === selectedKey).name}」を適用しました`);
                    }
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

        const img = state.croppedImage;
        const skinOptions = getSkinOptions();
        const ditherSelect = document.getElementById('dither-select');
        const ditherStrength = document.getElementById('dither-strength');
        const ditherType = ditherSelect ? ditherSelect.value : 'none';

        const msg = {
            type: 'convert',
            data: img.data,
            width: img.width,
            height: img.height,
            palette: state.currentPalette,
            ditherType: ditherType === 'checkerboard' || ditherType === 'bayer' ||
                        ditherType === 'floyd-steinberg' || ditherType === 'random'
                        ? ditherType : 'none',
            ditherStrength: ditherStrength ? parseInt(ditherStrength.value) : 80,
            bayerSize: 4,
            randomSeed: 42,
            skinOptions: skinOptions
        };
        /* 既存のマスクがあれば転送して再計算を省略 */
        if (skinOptions && skinOptions.skinDither && skinOptions.skinDither.enabled && state.skinMask) {
            msg.mask = state.skinMask;
        }
        worker.postMessage(msg);
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
        Menu.disableEntry('save-png');
        Menu.disableEntry('save-bmp');
        Menu.disableEntry('save-mag');
        Menu.disableEntry('view-original');
        Menu.disableEntry('view-converted');
        Menu.disableEntry('view-compare');
        Menu.disableEntry('view-zoom');
        Preview.reset();
        StatusBar.setMessage('リセットしました - パラメータを調整してください');
    }

    /* --- ファイル保存 --- */
    function getDefaultFileName(ext) {
        const now = new Date();
        const ts = now.getFullYear().toString() +
            String(now.getMonth() + 1).padStart(2, '0') +
            String(now.getDate()).padStart(2, '0') + '_' +
            String(now.getHours()).padStart(2, '0') +
            String(now.getMinutes()).padStart(2, '0') +
            String(now.getSeconds()).padStart(2, '0');
        const base = state.fileName ? state.fileName.replace(/\.[^.]+$/, '') : 'gazo98';
        return `${base}_${ts}.${ext}`;
    }

    function savePNG() {
        if (!state.convertedImage || !state.currentPalette) return;
        PngExport.save(state.convertedImage, state.currentPalette, getDefaultFileName('png'));
        StatusBar.setMessage('PNG保存完了');
    }

    function saveBMP() {
        if (!state.convertedImage || !state.currentPalette) return;
        BmpExport.save(state.convertedImage, state.currentPalette, getDefaultFileName('bmp'));
        StatusBar.setMessage('BMP保存完了');
    }

    function saveMAG() {
        if (!state.convertedImage || !state.currentPalette) return;
        const comment = state.fileName || 'GAZO98';
        MagExport.save(state.convertedImage, state.currentPalette, getDefaultFileName('mag'), comment);
        StatusBar.setMessage('MAG保存完了');
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

        /* Previewリセット（ズーム等の状態をクリア） */
        Preview.reset();

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
        state.skinMask = null;
        state.maskPreviewActive = false;

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
        Menu.disableEntry('save-png');
        Menu.disableEntry('save-bmp');
        Menu.disableEntry('save-mag');
        Menu.disableEntry('view-original');
        Menu.disableEntry('view-converted');
        Menu.disableEntry('view-compare');
        Menu.disableEntry('view-zoom');

        /* エフェクトリセット */
        document.getElementById('effect-scanline').disabled = true;
        document.getElementById('effect-scanline').checked = false;
        document.getElementById('effect-crt').disabled = true;
        document.getElementById('effect-crt').checked = false;
        document.getElementById('effect-sharp').disabled = true;
        document.getElementById('effect-sharp').checked = false;

        Preview.reset();

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

        /* 肌感改善コントロールをリセット */
        document.getElementById('skin-mode').disabled = true;
        document.getElementById('skin-mode').value = 'off';
        document.getElementById('skin-weight-settings').style.display = 'none';
        document.getElementById('skin-separate-settings').style.display = 'none';
        document.getElementById('skin-dither-enable').disabled = true;
        document.getElementById('skin-dither-enable').checked = false;
        document.getElementById('skin-dither-settings').style.display = 'none';
        document.getElementById('btn-mask-preview').disabled = true;
        document.getElementById('btn-mask-preview').textContent = '[ マスク確認 ]';
        document.getElementById('btn-skin-detect-settings').disabled = true;
    }

    return { init, PC98, state };
})();

/* DOMContentLoaded で初期化 */
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
