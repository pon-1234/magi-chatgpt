# MAGI System - Chrome拡張版

ChatGPT Web UIを5タブ並列で操作し、MAGI三賢人をモチーフにした5つのエージェントが議論・統合・最終判断まで自動実行するChrome拡張です。Playwright依存のスタンドアロンアプリから、ブラウザ内で完結する方式に刷新しました。

## 🧱 構成

- `extension/manifest.json` … Manifest v3 設定
- `extension/background.js` … エージェント管理・ラウンド制御
- `extension/content.js` … ChatGPTタブ上でのDOM操作（送信/応答取得）
- `extension/popup.html|js|css` … テーマとラウンド数を入力するUI

## 🚀 セットアップ

1. Chromeで `chrome://extensions/` を開き、右上の**デベロッパーモード**を有効化  
2. **パッケージ化されていない拡張機能を読み込む** → このリポジトリの `extension/` を選択  
3. ChatGPT (https://chatgpt.com/) に通常どおりログインしておく  
4. ブラウザ右上の MAGI アイコンをクリックしてポップアップを開く

## 🧭 使い方

1. ポップアップで議題とラウンド数を入力し、「議論を開始」を押下  
2. 背景で5つのChatGPTタブ（MELCHIOR/BALTHASAR/CASPER/ANALYST/JUDGE）が順に開き、人格初期化が走る  
3. 各ラウンドは **M/B/C → ANALYST要約 → 次ラウンド** の順で進行し、最後にJUDGEがMarkdownレポートを出力  
4. 進捗と最終まとめはポップアップのログエリアに逐次表示され、必要に応じて「停止」ボタンで途中打ち切りが可能

> ⚠️ CloudflareやChatGPTのUI変更により動作が止まる場合があります。ログに「Composerが見つかりません」等が出たら、`content.js` 内のセレクタ調整を行ってください。

## 🔧 カスタマイズ

- `background.js` の `DEFAULT_AGENTS` 配列で各エージェントの役割・ラウンド指示を調整可能  
- 議論フローやタイムアウト (`RESPONSE_TIMEOUT_MS`) は `background.js` の定数で変更  
- DOMセレクタやレスポンス抽出ロジックは `content.js` で管理

## 📄 ライセンス

MIT License（詳細は `LICENSE` がある場合はそちらに従います）。
