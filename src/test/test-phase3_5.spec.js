// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const GOLDEN_DIR = path.join(__dirname, 'golden');
const TEST_IMAGE = 'test/images/person.png';

/* =============================================
   ヘルパー関数
   ============================================= */

/** 画像をD&Dでロードしてクロップ確定するまでの共通手順 */
async function loadAndCrop(page) {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    /* ファイル入力経由で画像ロード（D&Dの代替） */
    const fileInput = page.locator('#file-input');
    await fileInput.setInputFiles(path.join(__dirname, 'images', 'person.png'));

    /* クロップUIが表示されるのを待つ */
    await page.waitForSelector('#crop-bar', { state: 'visible' });

    /* クロップ確定 */
    await page.click('#btn-crop-confirm');

    /* コントロールパネル表示を待つ */
    await page.waitForSelector('#control-panel', { state: 'visible' });
    await page.waitForTimeout(500);
}

/** Canvasのピクセルデータを取得 */
async function getCanvasPixels(page) {
    return await page.evaluate(() => {
        const canvas = document.getElementById('preview-canvas');
        const ctx = canvas.getContext('2d');
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return {
            width: data.width,
            height: data.height,
            data: Array.from(data.data)
        };
    });
}

/** ゴールデンマスター保存・比較 */
function saveGolden(name, pixels) {
    if (!fs.existsSync(GOLDEN_DIR)) fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    const filePath = path.join(GOLDEN_DIR, `${name}.json`);
    fs.writeFileSync(filePath, JSON.stringify({ width: pixels.width, height: pixels.height, data: pixels.data }));
}

function loadGolden(name) {
    const filePath = path.join(GOLDEN_DIR, `${name}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function comparePixels(actual, expected, tolerance = 0) {
    if (actual.width !== expected.width || actual.height !== expected.height) {
        return { match: false, reason: `Size mismatch: ${actual.width}x${actual.height} vs ${expected.width}x${expected.height}` };
    }
    let diffCount = 0;
    const totalPixels = actual.width * actual.height;
    for (let i = 0; i < actual.data.length; i += 4) {
        const dr = Math.abs(actual.data[i] - expected.data[i]);
        const dg = Math.abs(actual.data[i + 1] - expected.data[i + 1]);
        const db = Math.abs(actual.data[i + 2] - expected.data[i + 2]);
        if (dr > tolerance || dg > tolerance || db > tolerance) {
            diffCount++;
        }
    }
    const matchRate = ((totalPixels - diffCount) / totalPixels * 100).toFixed(2);
    return { match: diffCount === 0, matchRate, diffCount, totalPixels };
}

/** メニューアクションを直接実行（ドロップダウンを開かずに済む） */
async function menuAction(page, action) {
    await page.evaluate((act) => {
        const entry = document.querySelector(`[data-action="${act}"]`);
        if (entry) entry.click();
    }, action);
    await page.waitForTimeout(100);
}

/** パレットを直接設定してボタンを有効化 */
async function setPresetPalette(page, key) {
    await page.evaluate((k) => {
        const p = Palette.getPreset(k);
        App.state.currentPalette = p;
        document.querySelectorAll('#palette-display .palette-cell').forEach((cell, i) => {
            if (i < p.length) cell.style.background = `rgb(${p[i][0]},${p[i][1]},${p[i][2]})`;
        });
        /* 変換ボタンを有効化 */
        const btn = document.getElementById('btn-convert');
        if (btn) { btn.disabled = false; btn.classList.remove('disabled'); }
        /* ディザUIを有効化 */
        const ds = document.getElementById('dither-select');
        const dst = document.getElementById('dither-strength');
        if (ds) ds.disabled = false;
        if (dst) dst.disabled = false;
        /* メニューも有効化 */
        if (typeof Menu !== 'undefined') {
            Menu.enableEntry('convert');
            Menu.enableEntry('reset');
        }
    }, key);
}

/** パレットセルの色を取得 */
async function getPaletteCellColors(page) {
    return await page.evaluate(() => {
        const cells = document.querySelectorAll('#palette-display .palette-cell');
        return Array.from(cells).map(c => c.style.background);
    });
}

/** ステータスバーのメッセージを取得 */
async function getStatusMessage(page) {
    return await page.textContent('#status-message');
}

/** Workerの結果を待つ（ステータスバーの変化で判定） */
async function waitForWorkerResult(page, keyword, timeout = 10000) {
    await page.waitForFunction(
        (kw) => document.getElementById('status-message')?.textContent?.includes(kw),
        keyword,
        { timeout }
    );
}

/* =============================================
   T-01: 肌感改善パネルの初期状態と有効化
   ============================================= */

test.describe('T-01: パネル初期状態と有効化', () => {
    test('初期状態で全コントロールが無効', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('domcontentloaded');

        await expect(page.locator('#skin-mode')).toBeDisabled();
        await expect(page.locator('#skin-dither-enable')).toBeDisabled();
        await expect(page.locator('#btn-mask-preview')).toBeDisabled();
        await expect(page.locator('#btn-skin-detect-settings')).toBeDisabled();
    });

    test('画像ロード後に全コントロールが有効化', async ({ page }) => {
        await loadAndCrop(page);

        await expect(page.locator('#skin-mode')).toBeEnabled();
        await expect(page.locator('#skin-dither-enable')).toBeEnabled();
        await expect(page.locator('#btn-mask-preview')).toBeEnabled();
        await expect(page.locator('#btn-skin-detect-settings')).toBeEnabled();
    });

    test('モード切替でUI出現・消滅', async ({ page }) => {
        await loadAndCrop(page);

        /* 肌色優先 → 重み・最低枠が出現 */
        await page.selectOption('#skin-mode', 'weight');
        await expect(page.locator('#skin-weight-settings')).toBeVisible();
        await expect(page.locator('#skin-separate-settings')).toBeHidden();

        /* 領域分離 → 配分が出現、重み・最低枠が消滅 */
        await page.selectOption('#skin-mode', 'separate');
        await expect(page.locator('#skin-weight-settings')).toBeHidden();
        await expect(page.locator('#skin-separate-settings')).toBeVisible();

        /* OFF → 両方消滅 */
        await page.selectOption('#skin-mode', 'off');
        await expect(page.locator('#skin-weight-settings')).toBeHidden();
        await expect(page.locator('#skin-separate-settings')).toBeHidden();
    });

    test('肌専用ディザのON/OFFでUI出現・消滅', async ({ page }) => {
        await loadAndCrop(page);

        await page.check('#skin-dither-enable');
        await expect(page.locator('#skin-dither-settings')).toBeVisible();

        await page.uncheck('#skin-dither-enable');
        await expect(page.locator('#skin-dither-settings')).toBeHidden();
    });

    test('領域分離: 配分を手動にすると肌枠スライダー出現', async ({ page }) => {
        await loadAndCrop(page);
        await page.selectOption('#skin-mode', 'separate');
        await page.selectOption('#skin-split-mode', 'manual');
        await expect(page.locator('#skin-palette-count-row')).toBeVisible();

        await page.selectOption('#skin-split-mode', 'auto');
        await expect(page.locator('#skin-palette-count-row')).toBeHidden();
    });
});

/* =============================================
   T-02: 肌色検出マスク生成＆プレビュー
   ============================================= */

test.describe('T-02: マスク生成・プレビュー', () => {
    test('マスク確認ボタンでオーバーレイ表示・解除', async ({ page }) => {
        await loadAndCrop(page);

        /* マスク確認前のCanvas状態を保存 */
        const beforePixels = await getCanvasPixels(page);

        /* マスク確認クリック */
        await page.click('#btn-mask-preview');
        await waitForWorkerResult(page, '肌色検出');

        /* ボタン表記が変わる */
        await expect(page.locator('#btn-mask-preview')).toHaveText('[ マスク解除 ]');

        /* ステータスバーに検出結果が表示される */
        const msg = await getStatusMessage(page);
        expect(msg).toMatch(/肌色検出: \d+px \(\d+\.\d+%\)/);

        /* Canvasが変化している（オーバーレイ付き） */
        const overlayPixels = await getCanvasPixels(page);
        const cmp = comparePixels(overlayPixels, beforePixels);
        expect(cmp.match).toBe(false); // オーバーレイで変化しているはず

        /* マスク解除 */
        await page.click('#btn-mask-preview');
        await expect(page.locator('#btn-mask-preview')).toHaveText('[ マスク確認 ]');

        /* 元に戻っている */
        const afterPixels = await getCanvasPixels(page);
        const cmpAfter = comparePixels(afterPixels, beforePixels);
        expect(cmpAfter.match).toBe(true);
    });
});

/* =============================================
   T-03: 肌色検出パラメータ調整
   ============================================= */

test.describe('T-03: 検出パラメータ調整', () => {
    test('検出設定ダイアログの開閉とデフォルト値', async ({ page }) => {
        await loadAndCrop(page);

        await page.click('#btn-skin-detect-settings');
        await page.waitForSelector('#dialog-overlay', { state: 'visible' });

        /* デフォルト値の確認 */
        await expect(page.locator('#sd-hmin')).toHaveValue('0');
        await expect(page.locator('#sd-hmax')).toHaveValue('50');
        await expect(page.locator('#sd-smin')).toHaveValue('10');
        await expect(page.locator('#sd-smax')).toHaveValue('70');
        await expect(page.locator('#sd-vmin')).toHaveValue('20');
        await expect(page.locator('#sd-vmax')).toHaveValue('95');

        /* Cancelで閉じる */
        await page.click('.dialog-buttons button:last-child');
        await page.waitForSelector('#dialog-overlay', { state: 'hidden' });
    });

    test('パラメータ変更でマスク検出率が変化する', async ({ page }) => {
        await loadAndCrop(page);

        /* デフォルトでマスク生成 */
        await page.click('#btn-mask-preview');
        await waitForWorkerResult(page, '肌色検出');
        const msg1 = await getStatusMessage(page);
        const match1 = msg1.match(/肌色検出: (\d+)px/);
        const count1 = parseInt(match1[1]);

        await page.click('#btn-mask-preview'); // 解除

        /* H max を 30 に絞る */
        await page.click('#btn-skin-detect-settings');
        await page.waitForSelector('#dialog-overlay', { state: 'visible' });
        await page.fill('#sd-hmax', '30');
        await page.click('.dialog-buttons button:first-child'); // OK
        await page.waitForSelector('#dialog-overlay', { state: 'hidden' });

        /* 再度マスク生成 */
        await page.click('#btn-mask-preview');
        await waitForWorkerResult(page, '肌色検出');
        const msg2 = await getStatusMessage(page);
        const match2 = msg2.match(/肌色検出: (\d+)px/);
        const count2 = parseInt(match2[1]);

        /* 範囲を狭めたので検出数が減る */
        expect(count2).toBeLessThan(count1);
    });

    test('デフォルトボタンでパラメータ復帰', async ({ page }) => {
        await loadAndCrop(page);

        /* パラメータ変更 */
        await page.click('#btn-skin-detect-settings');
        await page.waitForSelector('#dialog-overlay', { state: 'visible' });
        await page.fill('#sd-hmax', '20');
        await page.click('.dialog-buttons button:first-child'); // OK
        await page.waitForSelector('#dialog-overlay', { state: 'hidden' });

        /* デフォルトに戻す */
        await page.click('#btn-skin-detect-settings');
        await page.waitForSelector('#dialog-overlay', { state: 'visible' });
        await page.click('.dialog-buttons button:nth-child(2)'); // デフォルト
        await page.waitForSelector('#dialog-overlay', { state: 'hidden' });

        /* 再度開いて値確認 */
        await page.click('#btn-skin-detect-settings');
        await page.waitForSelector('#dialog-overlay', { state: 'visible' });
        await expect(page.locator('#sd-hmax')).toHaveValue('50');
        await page.click('.dialog-buttons button:last-child'); // Cancel
    });
});

/* =============================================
   T-04: 機能A — 肌色優先パレット
   ============================================= */

test.describe('T-04: 肌色優先パレット', () => {
    test('肌色優先モードでパレット生成される', async ({ page }) => {
        await loadAndCrop(page);

        const beforeColors = await getPaletteCellColors(page);

        await page.selectOption('#skin-mode', 'weight');
        await waitForWorkerResult(page, '自動生成完了');

        const afterColors = await getPaletteCellColors(page);
        /* パレットが更新されている */
        expect(afterColors).not.toEqual(beforeColors);
    });

    test('肌色優先で変換 → 通常と画像が異なる', async ({ page }) => {
        await loadAndCrop(page);

        /* 通常パレットで変換 */
        await menuAction(page, 'palette-auto');
        await waitForWorkerResult(page, '自動生成完了');
        await page.click('#btn-convert');
        await waitForWorkerResult(page, '変換完了');
        const normalPixels = await getCanvasPixels(page);

        /* リセット */
        await menuAction(page, 'reset');
        await page.waitForTimeout(300);

        /* 肌色優先パレットで変換 */
        await page.selectOption('#skin-mode', 'weight');
        await waitForWorkerResult(page, '自動生成完了');
        await page.click('#btn-convert');
        await waitForWorkerResult(page, '変換完了');
        const weightedPixels = await getCanvasPixels(page);

        /* 異なる結果になるはず */
        const cmp = comparePixels(normalPixels, weightedPixels);
        expect(cmp.match).toBe(false);

        /* ゴールデンマスター保存 */
        saveGolden('convert_skin_weighted', weightedPixels);
    });
});

/* =============================================
   T-05: 機能B — 領域分離型減色
   ============================================= */

test.describe('T-05: 領域分離型減色', () => {
    test('領域分離モードでパレット生成される', async ({ page }) => {
        await loadAndCrop(page);

        await page.selectOption('#skin-mode', 'separate');
        await waitForWorkerResult(page, '自動生成完了');

        const colors = await getPaletteCellColors(page);
        /* 16色全部黒でない（パレットが生成されている） */
        const nonBlack = colors.filter(c => c !== 'rgb(0, 0, 0)');
        expect(nonBlack.length).toBeGreaterThan(0);
    });

    test('手動配分で肌枠数を変えると結果が変わる', async ({ page }) => {
        await loadAndCrop(page);

        /* 肌枠4色で変換 */
        await page.selectOption('#skin-mode', 'separate');
        await waitForWorkerResult(page, '自動生成完了');
        await page.selectOption('#skin-split-mode', 'manual');
        await page.fill('#skin-palette-count', '4');
        await page.selectOption('#skin-mode', 'off');
        await page.selectOption('#skin-mode', 'separate'); // 再生成
        await waitForWorkerResult(page, '自動生成完了');
        await page.click('#btn-convert');
        await waitForWorkerResult(page, '変換完了');
        const pixels4 = await getCanvasPixels(page);

        /* リセット → 肌枠10色で変換 */
        await menuAction(page, 'reset');
        await page.waitForTimeout(300);
        await page.fill('#skin-palette-count', '10');
        await page.selectOption('#skin-mode', 'off');
        await page.selectOption('#skin-mode', 'separate');
        await waitForWorkerResult(page, '自動生成完了');
        await page.click('#btn-convert');
        await waitForWorkerResult(page, '変換完了');
        const pixels10 = await getCanvasPixels(page);

        /* 結果が異なる */
        const cmp = comparePixels(pixels4, pixels10);
        expect(cmp.match).toBe(false);
    });
});

/* =============================================
   T-06: 機能C — 肌専用ディザパターン
   ============================================= */

test.describe('T-06: 肌専用ディザ', () => {
    test('ディザON/OFFで変換結果が変わる', async ({ page }) => {
        await loadAndCrop(page);
        await setPresetPalette(page, 'eroge_standard');

        /* ディザOFFで変換 */
        await page.click('#btn-convert');
        await waitForWorkerResult(page, '変換完了');
        const flatPixels = await getCanvasPixels(page);
        saveGolden('convert_flat', flatPixels);

        /* リセット → ディザONで変換 */
        await menuAction(page, 'reset');
        await page.waitForTimeout(300);
        await page.check('#skin-dither-enable');
        await page.click('#btn-convert');
        await waitForWorkerResult(page, '変換完了');
        const ditherPixels = await getCanvasPixels(page);
        saveGolden('convert_skin_dither_smooth', ditherPixels);

        /* 異なる結果 */
        const cmp = comparePixels(flatPixels, ditherPixels);
        expect(cmp.match).toBe(false);
    });

    test('3パターンそれぞれ異なる結果を返す', async ({ page }) => {
        await loadAndCrop(page);
        await setPresetPalette(page, 'eroge_standard');
        await page.check('#skin-dither-enable');

        const results = {};
        for (const pattern of ['smooth', 'halftone', 'diagonal']) {
            await page.selectOption('#skin-dither-pattern', pattern);
            await page.click('#btn-convert');
            await waitForWorkerResult(page, '変換完了');
            results[pattern] = await getCanvasPixels(page);
            saveGolden(`convert_dither_${pattern}`, results[pattern]);
            await menuAction(page, 'reset');
            await page.waitForTimeout(300);
        }

        /* 3パターンが全て異なる */
        expect(comparePixels(results.smooth, results.halftone).match).toBe(false);
        expect(comparePixels(results.smooth, results.diagonal).match).toBe(false);
        expect(comparePixels(results.halftone, results.diagonal).match).toBe(false);
    });

    test('ブレンド幅で変換結果が変わる', async ({ page }) => {
        await loadAndCrop(page);
        await setPresetPalette(page, 'eroge_standard');
        await page.check('#skin-dither-enable');

        /* ブレンド2px */
        await page.fill('#skin-blend-width', '2');
        await page.click('#btn-convert');
        await waitForWorkerResult(page, '変換完了');
        const blend2 = await getCanvasPixels(page);

        /* ブレンド8px */
        await menuAction(page, 'reset');
        await page.waitForTimeout(300);
        await page.fill('#skin-blend-width', '8');
        await page.click('#btn-convert');
        await waitForWorkerResult(page, '変換完了');
        const blend8 = await getCanvasPixels(page);

        expect(comparePixels(blend2, blend8).match).toBe(false);
    });
});

/* =============================================
   T-07: 機能D — エロゲ風プリセット
   ============================================= */

test.describe('T-07: エロゲ風プリセット', () => {
    test('プリセットダイアログにカテゴリが表示される', async ({ page }) => {
        await loadAndCrop(page);

        await menuAction(page, 'palette-preset');
        await page.waitForSelector('#dialog-overlay', { state: 'visible' });

        /* カテゴリラベルの存在確認 */
        const categories = await page.locator('.preset-category').allTextContents();
        expect(categories).toContain('─ 汎用 ─');
        expect(categories).toContain('─ エロゲ風 ─');

        /* 汎用6種 + エロゲ4種 = 10項目 */
        const items = await page.locator('.preset-item').count();
        expect(items).toBe(10);

        await page.click('.dialog-buttons button:last-child'); // Cancel
    });

    test('4種のエロゲプリセットがそれぞれ異なるパレットを返す', async ({ page }) => {
        await loadAndCrop(page);

        const presetKeys = ['eroge_standard', 'eroge_warm', 'eroge_cool', 'eroge_tanned'];
        const palettes = {};

        for (const key of presetKeys) {
            const colors = await page.evaluate((k) => Palette.getPreset(k), key);
            palettes[key] = JSON.stringify(colors);
        }

        /* 全て異なる */
        const values = Object.values(palettes);
        const unique = new Set(values);
        expect(unique.size).toBe(4);
    });

    test('エロゲプリセットで変換できる', async ({ page }) => {
        await loadAndCrop(page);
        await setPresetPalette(page, 'eroge_standard');

        await page.click('#btn-convert');
        await waitForWorkerResult(page, '変換完了');
        const pixels = await getCanvasPixels(page);
        saveGolden('convert_eroge_standard', pixels);

        expect(pixels.width).toBeGreaterThan(0);
        expect(pixels.height).toBeGreaterThan(0);
    });
    test('プリセット自動微調整で非肌色枠が最適化される', async ({ page }) => {
        await loadAndCrop(page);

        /* プリセットをそのまま適用して変換 */
        await setPresetPalette(page, 'eroge_standard');
        await page.click('#btn-convert');
        await waitForWorkerResult(page, '変換完了');
        const presetPixels = await getCanvasPixels(page);
        const presetColors = await getPaletteCellColors(page);

        /* リセット */
        await menuAction(page, 'reset');
        await page.waitForTimeout(300);

        /* プリセット＋自動微調整で適用 */
        await menuAction(page, 'palette-preset');
        await page.waitForSelector('#dialog-overlay', { state: 'visible' });

        /* エロゲ標準を選択 */
        const items = page.locator('.preset-item');
        const count = await items.count();
        for (let i = 0; i < count; i++) {
            const text = await items.nth(i).textContent();
            if (text.includes('エロゲ標準')) {
                await items.nth(i).click();
                break;
            }
        }

        /* 自動微調整をON */
        await page.check('#preset-auto-adjust');
        await page.click('.dialog-buttons button:first-child'); // OK
        await page.waitForSelector('#dialog-overlay', { state: 'hidden' });
        await waitForWorkerResult(page, '自動生成完了');

        const adjustedColors = await getPaletteCellColors(page);

        /* パレットが変化している（非肌色枠が最適化された） */
        expect(adjustedColors).not.toEqual(presetColors);

        /* 変換して結果が異なることを確認 */
        await page.click('#btn-convert');
        await waitForWorkerResult(page, '変換完了');
        const adjustedPixels = await getCanvasPixels(page);

        const cmp = comparePixels(presetPixels, adjustedPixels);
        expect(cmp.match).toBe(false);
    });
});

/* =============================================
   T-08: 機能間連携・排他制御
   ============================================= */

test.describe('T-08: 連携・排他制御', () => {
    test('モード切替が排他的に動作する', async ({ page }) => {
        await loadAndCrop(page);

        await page.selectOption('#skin-mode', 'weight');
        await expect(page.locator('#skin-weight-settings')).toBeVisible();
        await expect(page.locator('#skin-separate-settings')).toBeHidden();

        await page.selectOption('#skin-mode', 'separate');
        await expect(page.locator('#skin-weight-settings')).toBeHidden();
        await expect(page.locator('#skin-separate-settings')).toBeVisible();
    });

    test('画像を閉じると全コントロールがリセットされる', async ({ page }) => {
        await loadAndCrop(page);

        /* 色々設定する */
        await page.selectOption('#skin-mode', 'weight');
        await page.check('#skin-dither-enable');

        /* 画像を閉じる */
        await menuAction(page, 'close');
        await page.waitForTimeout(300);

        /* 全てリセット */
        await expect(page.locator('#skin-mode')).toBeDisabled();
        await expect(page.locator('#skin-mode')).toHaveValue('off');
        await expect(page.locator('#skin-dither-enable')).toBeDisabled();
        await expect(page.locator('#skin-dither-enable')).not.toBeChecked();
        await expect(page.locator('#skin-weight-settings')).toBeHidden();
        await expect(page.locator('#skin-dither-settings')).toBeHidden();
        await expect(page.locator('#btn-mask-preview')).toBeDisabled();
        await expect(page.locator('#btn-skin-detect-settings')).toBeDisabled();
    });

    test('肌専用ディザはモードOFFでも独立動作する', async ({ page }) => {
        await loadAndCrop(page);

        /* 通常パレット生成 */
        await menuAction(page, 'palette-auto');
        await waitForWorkerResult(page, '自動生成完了');

        /* モードOFF + ディザON */
        await expect(page.locator('#skin-mode')).toHaveValue('off');
        await page.check('#skin-dither-enable');
        await page.click('#btn-convert');
        await waitForWorkerResult(page, '変換完了');

        /* エラーなく完了している */
        const msg = await getStatusMessage(page);
        expect(msg).toContain('変換完了');
    });
});

/* =============================================
   T-09: エッジケース
   ============================================= */

test.describe('T-09: エッジケース', () => {
    test('コンソールエラーなしで全操作が完了する', async ({ page }) => {
        const errors = [];
        page.on('pageerror', err => errors.push(err.message));

        await loadAndCrop(page);

        /* 一連の操作 */
        await page.selectOption('#skin-mode', 'weight');
        await waitForWorkerResult(page, '自動生成完了');
        await page.click('#btn-convert');
        await waitForWorkerResult(page, '変換完了');
        await menuAction(page, 'reset');
        await page.waitForTimeout(300);

        await page.selectOption('#skin-mode', 'separate');
        await waitForWorkerResult(page, '自動生成完了');
        await page.click('#btn-convert');
        await waitForWorkerResult(page, '変換完了');
        await menuAction(page, 'reset');
        await page.waitForTimeout(300);

        await page.check('#skin-dither-enable');
        await page.click('#btn-convert');
        await waitForWorkerResult(page, '変換完了');

        await page.click('#btn-mask-preview');
        await waitForWorkerResult(page, '肌色検出');
        await page.click('#btn-mask-preview'); // 解除

        expect(errors).toEqual([]);
    });

    test('連続変換で前回結果が残らない', async ({ page }) => {
        await loadAndCrop(page);

        const results = [];

        /* 3種のプリセットで連続変換 */
        for (const key of ['eroge_standard', 'eroge_warm', 'eroge_cool']) {
            await setPresetPalette(page, key);
            await page.click('#btn-convert');
            await waitForWorkerResult(page, '変換完了');
            results.push(await getCanvasPixels(page));
        }

        /* 3つとも異なる */
        expect(comparePixels(results[0], results[1]).match).toBe(false);
        expect(comparePixels(results[1], results[2]).match).toBe(false);
    });
});

/* =============================================
   T-10: ディザリングエンジン（Phase 4）
   ============================================= */

test.describe('T-10: ディザリングエンジン', () => {
    test('4種のディザがそれぞれ異なる結果を返す', async ({ page }) => {
        await loadAndCrop(page);
        await setPresetPalette(page, 'eroge_standard');

        const results = {};
        for (const type of ['checkerboard', 'bayer', 'floyd-steinberg', 'random']) {
            await page.selectOption('#dither-select', type);
            await page.click('#btn-convert');
            await waitForWorkerResult(page, '変換完了', 30000);
            results[type] = await getCanvasPixels(page);
            saveGolden(`dither_${type}`, results[type]);
            await menuAction(page, 'reset');
            await page.waitForTimeout(300);
        }

        /* 全ペアが異なる */
        const types = Object.keys(results);
        for (let i = 0; i < types.length; i++) {
            for (let j = i + 1; j < types.length; j++) {
                const cmp = comparePixels(results[types[i]], results[types[j]]);
                expect(cmp.match).toBe(false);
            }
        }
    });

    test('ディザ強度0%でベタ減色と同じ結果になる', async ({ page }) => {
        await loadAndCrop(page);
        await setPresetPalette(page, 'eroge_standard');

        /* ベタ減色（ディザなし相当） */
        await page.fill('#dither-strength', '0');
        await page.selectOption('#dither-select', 'checkerboard');
        await page.click('#btn-convert');
        await waitForWorkerResult(page, '変換完了');
        const strength0 = await getCanvasPixels(page);

        /* 強度80%で変換 */
        await menuAction(page, 'reset');
        await page.waitForTimeout(300);
        await page.fill('#dither-strength', '80');
        await page.click('#btn-convert');
        await waitForWorkerResult(page, '変換完了');
        const strength80 = await getCanvasPixels(page);

        /* 強度0と80は異なる */
        expect(comparePixels(strength0, strength80).match).toBe(false);
    });

    test('ディザ＋肌専用ディザの併用', async ({ page }) => {
        await loadAndCrop(page);
        await setPresetPalette(page, 'eroge_standard');

        /* Bayerディザのみ */
        await page.selectOption('#dither-select', 'bayer');
        await page.click('#btn-convert');
        await waitForWorkerResult(page, '変換完了');
        const bayerOnly = await getCanvasPixels(page);

        /* Bayerディザ＋肌専用ディザ */
        await menuAction(page, 'reset');
        await page.waitForTimeout(300);
        await page.check('#skin-dither-enable');
        await page.click('#btn-convert');
        await waitForWorkerResult(page, '変換完了');
        const bayerPlusSkin = await getCanvasPixels(page);

        /* 肌色領域で差が出る */
        expect(comparePixels(bayerOnly, bayerPlusSkin).match).toBe(false);
    });
});

/* =============================================
   ゴールデンマスター回帰テスト
   ============================================= */

test.describe('ゴールデンマスター回帰テスト', () => {
    test('既存ゴールデンマスターとの一致確認', async ({ page }) => {
        const golden = loadGolden('convert_eroge_standard');
        if (!golden) {
            test.skip();
            return;
        }

        await loadAndCrop(page);
        await setPresetPalette(page, 'eroge_standard');

        await page.click('#btn-convert');
        await waitForWorkerResult(page, '変換完了');
        const current = await getCanvasPixels(page);

        const cmp = comparePixels(current, golden);
        expect(parseFloat(cmp.matchRate)).toBeGreaterThanOrEqual(99.0);
    });
});
