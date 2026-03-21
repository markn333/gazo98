# GAZO98 技術仕様書

## 1. アーキテクチャ

### 1.1 全体構成

```
index.html
  ├── css/
  │   ├── main.css          # レイアウト・共通スタイル
  │   ├── pc98-theme.css    # 98風UIコンポーネント
  │   └── responsive.css    # レスポンシブ対応
  ├── js/
  │   ├── app.js            # エントリポイント
  │   ├── ui/               # UI層（DOM操作）
  │   ├── engine/           # 画像処理エンジン層
  │   ├── io/               # ファイル入出力層
  │   └── worker/           # Web Worker
  ├── fonts/                # 美咲フォント
  └── assets/presets/       # プリセットパレットJSON
```

### 1.2 レイヤー設計

- **UI層** (`js/ui/`): DOM操作、イベントハンドリング、98風コンポーネント
- **エンジン層** (`js/engine/`): 純粋な画像処理ロジック（DOM非依存）
- **IO層** (`js/io/`): ファイル読み込み・各種形式エンコード・ダウンロード
- **Worker層** (`js/worker/`): 重い処理の非同期実行

UI層 → エンジン層 → Worker層（重い処理のみ）の一方向依存。IO層はエンジン層と同列。

## 2. PC-9801 カラー仕様

### 2.1 アナログパレット

- RGB各4bit（0〜15の16段階）
- 表示値: `channel_value * 17`（0, 17, 34, 51, ..., 255）
- 総色数: 16 × 16 × 16 = 4096色
- 同時表示色数: 16色

### 2.2 定数

```javascript
const PC98 = {
    COLOR_STEP: 17,
    COLORS_PER_CHANNEL: 16,
    TOTAL_COLORS: 4096,
    PALETTE_SIZE: 16,
    STANDARD_WIDTH: 640,
    STANDARD_HEIGHT: 400,
    ASPECT_RATIO: 8 / 5
};
```

## 3. 画像処理パイプライン

```
入力画像 → クロップ(8:5) → リサイズ → パレット生成(16色)
→ ディザリング → ポストエフェクト → 出力
```

### 3.1 パレット生成: メディアンカット法

1. 画像の全ピクセルをRGB色空間に配置
2. 最も分散の大きい軸で中央値分割
3. 16個のバケットになるまで繰り返し
4. 各バケットの重心を代表色とする
5. 代表色を4096色グリッドにスナップ（最近傍）

### 3.2 ディザリング

| 手法 | 処理場所 | 特徴 |
|------|---------|------|
| 市松パターン | メインスレッド | 座標偶奇で2色切替、98エロゲ最頻出 |
| Bayer行列 | メインスレッド | 規則的パターン、行列サイズ選択可 |
| Floyd-Steinberg | Web Worker | 誤差拡散、最も自然だが重い |
| ランダム | メインスレッド | ランダム閾値、シード固定可 |

### 3.3 ポストエフェクト適用順序

```
ディザリング結果 → ドット感強調 → CRTにじみ → スキャンライン
```

## 4. Web Worker プロトコル

ファイル: `js/worker/convert-worker.js`

### 4.1 メインスレッド → Worker

```javascript
// メディアンカット（通常）
{ type: "median-cut", data: Uint8ClampedArray, totalPixels: number, numColors: 16 }

// メディアンカット（肌色重視）
{ type: "median-cut-skin", data: Uint8ClampedArray, totalPixels: number, numColors: 16 }

// ベタ減色変換
{ type: "convert", data: Uint8ClampedArray, width: number, height: number, palette: [[r,g,b],...] }
```

### 4.2 Worker → メインスレッド

```javascript
// 進捗
{ type: "progress", phase: "median-cut" | "reducing", percent: number }

// パレット生成結果
{ type: "palette-result", palette: [[r,g,b],...] }

// 変換結果（Transferable）
{ type: "convert-result", data: Uint8ClampedArray, width: number, height: number }
```

## 5. MAG形式仕様

### 5.1 ファイル構造

- ヘッダ: `"MAKI02  "` (8byte) + コメント + `0x1A`
- ヘッダ情報: 座標・フラグオフセット・ピクセルオフセット等（30byte）
- パレット: 16色 × 2byte (GRB各4bit) = 32byte
- フラグA/Bデータ + ピクセルデータ

### 5.2 圧縮方式

1. 2ピクセル → 1byte（上位4bit:左、下位4bit:右）
2. 前行とのXOR差分
3. フラグAで行単位の繰り返し判定
4. フラグBでピクセルペア単位の一致判定
5. 非一致データのみピクセルデータとして格納

## 6. 出力形式

| 形式 | カラーモード | エフェクト | 備考 |
|------|------------|-----------|------|
| PNG | インデックス16色 / フルカラー | 選択可 | エフェクト有→フルカラー |
| BMP | 4bitインデックス | なし | Windows BMP形式 |
| MAG | 16色固定 | なし | PC-9801実機互換 |

## 7. 肌感改善エンジン（SKIN_ENHANCEMENT v1.0）

本セクションはPhase 3（パレット＆減色エンジン）およびPhase 4（ディザリングエンジン）に対する追加仕様。
詳細仕様: `SPEC_SKIN_ENHANCEMENT.md`

### 7.1 機能一覧

| 機能 | 概要 | 関連Phase |
|------|------|-----------|
| A: 肌色優先パレット | 重み付きメディアンカットで肌色にパレット枠を優先配分 | Phase 3.5 |
| B: 領域分離型減色 | 肌色/非肌色を分離し独立にメディアンカット（Aと排他） | Phase 3.5 |
| C: 肌専用ディザパターン | 肌色領域に専用ディザ（smooth_gradient/halftone/diagonal）＋境界ブレンド | Phase 3.5 |
| D: プリセット強化 | エロゲ風プリセット4種追加（標準/暖色/寒色/褐色肌） | Phase 3.5 |

### 7.2 肌色検出条件

HSV空間: H 0°〜50°, S 0.1〜0.7, V 0.2〜0.95
RGB補助: R > G > B, R-G ≤ 80, R-B ≥ 20
モルフォロジー平滑化（膨張3×3×2回 → 収縮3×3×1回）

### 7.3 機能間の排他・連携

- 機能A/Bは排他（両方ONなら機能B優先）
- 機能D選択時はA/Bの自動減色無効（「プリセットベース＋自動微調整」オプションあり）
- 肌色マスクはB/Cで共用キャッシュ（Uint8Array、パラメータ変更時のみ再生成）

### 7.4 パフォーマンス目標（追加分）

| 処理 | 目標時間 | 解像度 |
|------|---------|--------|
| 肌色検出（HSV変換＋判定＋モルフォロジー） | 150ms以内 | 640×400 |
| 領域分離メディアンカット | 通常の2倍以内 | 640×400 |

## 8. パフォーマンス目標

| 処理 | 目標時間 | 解像度 |
|------|---------|--------|
| 市松/Bayerディザ | 2秒以内 | 640×400 |
| Floyd-Steinberg | 5秒以内 | 640×400 |
| プレビュー更新 | 500msデバウンス | - |
