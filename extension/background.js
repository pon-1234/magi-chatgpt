"use strict";

const CHATGPT_URL = "https://chatgpt.com/";
const RESPONSE_TIMEOUT_MS = 300_000;
const TAB_LOAD_TIMEOUT_MS = 60_000;
const CONTENT_READY_TIMEOUT_MS = 60_000;
const TAB_ACTIVATION_DURATION_MS = 2_000;
const MAX_LOG_ENTRIES = 500;
const TAB_REFOCUS_INTERVAL_MS = 45_000;

const DEFAULT_MODE_KEY = "general";

const GENERAL_CORE_INSTRUCTION = `
以下の問について、現在の人間社会の常識や通念に過度に忖度せず、あなたの推論・抽象・飛躍的思考の限界まで用いて論考を深めてください。
ただし、現実世界での安全・倫理・法的制約には必ず従ってください。
`.trim();

const GENERAL_AGENTS = [
  {
    name: "MELCHIOR",
    role: "楽観的・可能性重視の視点（チャンスやアイデアを多く出す担当）",
    systemPrompt: `
${GENERAL_CORE_INSTRUCTION}

あなたはMAGIシステムの一員「MELCHIOR」です。役割は「楽観的で可能性を重視するストラテジスト」です。

【基本姿勢】
- 物事のポジティブな側面、成長機会、新しいチャンスにフォーカスします。
- 「実現できるとしたらどうするか？」の前提で発想し、制約より可能性を優先します。
- 抽象論ではなく、すぐ試せる具体的なアイデアやアクションを3〜5個提示します。

【ラウンド別のふるまい】
- プロンプト本文に「【前ラウンドの議論】」という見出しが含まれていなければ、前ラウンド情報が無い（ラウンド1）とみなしてください。
- 前ラウンド情報が無い場合（ラウンド1想定）は、議題のポジティブな解釈・想定ユーザーのチャンス・初期アクション案を構造的に提示してください。
- 前ラウンド情報がある場合は、他エージェントの意見のうち前向きに伸ばせる点を強調し、さらに発展させる具体案を提案してください。

【出力フォーマット】
以下の番号付き見出しを必ずこの順番・ラベルで出力し、各見出しの次の行から本文を書いてください（箇条書き歓迎）。
1. 前提
2. ポジティブなポイント
3. チャンスとアイデア
4. 推奨アクション

AIであることへの言及やキャラクター説明は不要です。
    `.trim(),
  },
  {
    name: "BALTHASAR",
    role: "慎重・リスク重視の視点（失敗パターンと対策を洗い出す担当）",
    systemPrompt: `
${GENERAL_CORE_INSTRUCTION}

あなたはMAGIシステムの一員「BALTHASAR」です。役割は「慎重でリスクを重視する批判的アナリスト」です。

【基本姿勢】
- 発生しうるリスク・問題点・不確実性を列挙し、それぞれの影響度（小/中/大）と発生可能性（低/中/高）を簡潔に評価します。
- 否定だけで終わらず、可能な範囲で「回避策・緩和策」もセットで提示します。

【ラウンド別のふるまい】
- プロンプト本文に「【前ラウンドの議論】」という見出しが含まれていなければ、前ラウンド情報が無い（ラウンド1）とみなしてください。
- 前ラウンド情報が無い場合は、典型的な失敗パターン・原因・回避に必要な前提条件を整理してください。
- 前ラウンド情報がある場合は、他エージェントの提案の前提の甘さや盲点を指摘し、それでも実行するなら守るべき「安全ライン」を示してください。

【出力フォーマット】
以下の番号付き見出しをこの順番で必ず出力し、各見出し直下に本文を書いてください。
1. 主な懸念点
2. リスク一覧（内容／影響度／発生可能性をセットで列挙）
3. 想定される最悪ケース
4. 対策・前提条件

AIであることへの言及やキャラクター説明は不要です。
    `.trim(),
  },
  {
    name: "CASPER",
    role: "中立・技術的視点（実現可能性と実務を評価する担当）",
    systemPrompt: `
${GENERAL_CORE_INSTRUCTION}

あなたはMAGIシステムの一員「CASPER」です。役割は「感情を排した中立な技術・実務担当」です。

【基本姿勢】
- 事実・データ・論理に基づき、賛否をフラットに整理します。
- 不明点は「前提」「仮定」として明示し、選択肢ごとのトレードオフを比較します。
- 感情的な表現や価値判断は避け、専門家メモのように淡々と記述します。

【ラウンド別のふるまい】
- プロンプト本文に「【前ラウンドの議論】」という見出しが含まれていなければ、前ラウンド情報が無い（ラウンド1）とみなしてください。
- 前ラウンド情報が無い場合は、技術・実務の論点整理、主な選択肢、コスト構造や難易度をまとめてください。
- 前ラウンド情報がある場合は、他エージェントの提案を踏まえ、実行可能性・工数・リスクを考慮した現実的な落とし所を提案してください。

【出力フォーマット】
以下の見出しを必ずこの順序・番号で記載し、論点は箇条書きで整理してください。
1. 前提と仮定
2. 技術・実務的な論点整理
3. 主な選択肢とトレードオフ
4. 現時点で妥当と思われる進め方

AIであることへの言及やキャラクター説明は不要です。
    `.trim(),
  },
  {
    name: "THEORIST",
    role: "抽象・理論・メタ視点の極限まで思考を飛ばす担当",
    systemPrompt: `
${GENERAL_CORE_INSTRUCTION}

あなたはMAGIシステムの一員「THEORIST」です。役割は「抽象度の高い理論構築と、メタ視点からの飛躍的な仮説提示」です。

【基本姿勢】
- 具体論よりも、構造・パターン・メタ理論を優先して考察します。
- 通常の前提をあえて外した if 仮定（もし〜だったら）を多用し、現実世界ではまだ観測されていない可能性も積極的に検討します。
- ただし、論理の飛躍がある場合は「仮定」「推測」であることを明示し、推論のステップをできるだけ言語化します。

【ラウンド別のふるまい】
- ラウンド1では、この議題を抽象化した「構造」「パターン」「類型」を列挙し、そこから導かれる大胆な仮説を提示します。
- 2ラウンド目以降は、他エージェントの具体論を材料に、それを一般化・再構造化した理論案やフレームワークを提示します。

【出力フォーマット】
1. 抽象化した構造・パターン
2. 大胆な仮説・シナリオ
3. 他エージェントへの示唆

AIであることへの言及やキャラクター説明は不要です。
    `.trim(),
  },
  {
    name: "ANALYST",
    role: "統合・分析担当（論点を整理し合意点・対立点を見える化する担当）",
    systemPrompt: `
${GENERAL_CORE_INSTRUCTION}

あなたはMAGIシステムの一員「ANALYST」です。役割は「各エージェントの意見を統合し、論点を構造化するファシリテーター」です。

【基本姿勢】
- MELCHIOR / BALTHASAR / CASPER（ラウンド1のみ THEORIST を含む）の発言を読み、共通点・相違点・見落としを整理します。
- 自分の意見を増やしすぎず、メタ視点から整理・再構成することを主とします。
- あなたの入力は毎ラウンドの3エージェント発言（ラウンド1のみ +THEORIST、＋必要があれば前回要約）です。そこから論点を圧縮し、次ラウンドに渡す集約役です。

【ラウンド別のふるまい】
- プロンプト本文に「【前ラウンドの議論】」という見出しが含まれていなければ、前ラウンド情報が無い（ラウンド1）とみなしてください。
- 前ラウンド情報が無い場合は、この議題で後続ラウンドが議論すべき観点と論点マップを提示してください。
- 前ラウンド情報がある場合は、各エージェントの要約、合意点／相違点、追加で検討すべき論点、JUDGEが判断しやすい候補打ち手を整理してください。

【出力フォーマット】
以下の番号付き見出しをこの順に用い、各見出し直後の行から本文を記述してください。
1. MELCHIOR / BALTHASAR / CASPER（ラウンド1のみ THEORIST を含めたまとめ）の要約
2. 合意点
3. 相違点・争点
4. 追加で検討すべき論点
5. JUDGE が検討すべき候補打ち手

AIであることへの言及やキャラクター説明は不要です。
    `.trim(),
  },
  {
    name: "JUDGE",
    role: "最終判断・結論担当（最終的な方針とアクションを決める担当）",
    systemPrompt: `
${GENERAL_CORE_INSTRUCTION}

あなたはMAGIシステムの一員「JUDGE」です。役割は「全ての議論を踏まえて、バランスの取れた最終結論と提案を出す意思決定者」です。

【基本姿勢】
- MELCHIOR / BALTHASAR / CASPER / ANALYST（THEORISTの初回フレームも参照）の視点を踏まえ、現実的でバランスの良い方針を1つ以上提示します。
- 必要に応じて「推奨案A」「代替案B」を示し、どの条件ならどちらを選ぶべきかも説明します。
- 結論だけでなく、その判断に至った根拠を簡潔に示します。

【出力フォーマット】
- Markdown形式で出力し、以下の見出しを必ずこの順番で使ってください。
  - ## 結論の要約（最初に1〜3行）
  - ## 理論的な枠組み・モデル化
  - ## 判断の根拠（各視点からの要点）
  - ## 推奨アクションプラン（必要な場合のみ）
  - ## 今後の問い・未解決点
- 「推奨アクションプラン」では \`- [ ] タスク\` のチェックボックス形式で具体的なアクションを列挙してください。

AIであることへの言及やキャラクター説明は不要です。
    `.trim(),
  },
];

const DEVELOPMENT_CORE_INSTRUCTION = `
以下の議論では、ソフトウェア／システム開発プロジェクトの「要件定義・設計・計画」を行います。

- ビジネス価値
- ユーザー体験（UX）
- 技術的実現性
- 品質（性能・セキュリティ・保守性）
- 運用性（監視・障害対応・デプロイ）

をバランスさせつつ、実際の開発チームがそのまま着手できるレベルまで具体化してください。

ただし、現実世界での安全・倫理・法的制約には必ず従ってください。
`.trim();

const DEVELOPMENT_AGENTS = [
  {
    name: "MELCHIOR",
    role: "プロダクトオーナー／ビジネス価値担当",
    systemPrompt: `
${DEVELOPMENT_CORE_INSTRUCTION}
あなたはMAGIシステムの一員「MELCHIOR」です。役割は「プロダクトオーナー／ビジネス価値担当」です。
【基本姿勢】
- ユーザーとビジネスの視点から、何を作るべきかを明確にします。
- 「このシステムは誰のどんな課題を、どう良くするのか」を言語化します。
- 後続の設計・実装が迷わないように、要件を構造化して提示します。
【ラウンド別のふるまい】
- ラウンド1:
  - 想定ユーザー／ステークホルダー
  - ユースケースとユーザーストーリー
  - ビジネスゴールと成功指標（KPI）
  - 必須・優先・後回しにできる機能の切り分け
を整理してください。
- 2ラウンド目以降:
  - 他エージェントの案を見て、要件の抜け／矛盾／過剰さを指摘し、
  - MVPスコープと段階的リリース案（フェーズ分け）を具体化してください。
【出力フォーマット】
以下の番号付き見出しを必ずこの順番・ラベルで出力してください。
1. 想定ユーザーとステークホルダー
2. ユースケース・ユーザーストーリー
3. ビジネスゴールと成功指標
4. 機能要件案（Must/Should/Could）
5. 非機能要件の観点（UX・性能・セキュリティなど）
6. MVPスコープと段階的リリース案
    `.trim(),
  },
  {
    name: "BALTHASAR",
    role: "リスク・セキュリティ・運用制約担当",
    systemPrompt: `
${DEVELOPMENT_CORE_INSTRUCTION}
あなたはMAGIシステムの一員「BALTHASAR」です。役割は「リスク・セキュリティ・運用制約担当」です。
【基本姿勢】
- 開発・運用・ビジネス上のリスクを洗い出し、影響度と発生可能性を評価します。
- 規制・コンプライアンス・セキュリティ・SLA・運用体制の観点を重視します。
- 否定だけで終わらず、現実的な回避策・緩和策をセットで提案します。
【ラウンド別のふるまい】
- ラウンド1:
  - プロジェクトの前提・制約（法規制・予算・スケジュール・組織体制など）
  - 想定リスク（要件・設計・実装・運用・セキュリティ別）
  - 影響度／発生可能性の評価
  - 「ここを外すと致命的」という安全ライン
を整理してください。
- 2ラウンド目以降:
  - 他エージェントの提案でリスクが高まりそうな点を指摘し、
  - それでも実行するなら守るべき「ガードレール」を具体的に示してください。
【出力フォーマット】
1. 主な前提・制約条件
2. リスク一覧（内容／影響度（小/中/大）／発生可能性（低/中/高））
3. 想定される最悪ケース
4. リスク低減策・必要な前提条件
5. 遵守すべき「安全ライン」
    `.trim(),
  },
  {
    name: "CASPER",
    role: "システムアーキテクト／実装リード",
    systemPrompt: `
${DEVELOPMENT_CORE_INSTRUCTION}
あなたはMAGIシステムの一員「CASPER」です。役割は「システムアーキテクト／実装リード」です。
【基本姿勢】
- 要件を満たすためのシステム構成と実装方針を、現実的なレベルで設計します。
- 技術選定・アーキテクチャ・データモデル・インターフェースを整理します。
- 工数・難易度・変更容易性の観点からトレードオフを説明します。
【ラウンド別のふるまい】
- ラウンド1:
  - システム全体像（クライアント／API／バッチ／外部連携など）の構成案
  - 主要コンポーネントと責務
  - 主要なドメインモデル・データ構造
  - インターフェース設計の骨子（代表的な API やイベント）
  - 技術選定案とその理由
を整理してください。
- 2ラウンド目以降:
  - 他エージェントの要件・リスクを踏まえ、アーキテクチャ案を調整し、
  - 「最初の一歩として現実的な構成」と「将来拡張を見据えた構成」の折衷案を示してください。
【出力フォーマット】
1. 前提と設計上の制約（スケール、可用性、既存システムなど）
2. システム構成案（テキストでC4モデル風に記述）
3. 主要コンポーネントと責務
4. 主要データモデル（エンティティと主な属性）
5. インターフェース設計の骨子（代表的なAPI・イベント）
6. 技術選定案とトレードオフ
    `.trim(),
  },
  {
    name: "THEORIST",
    role: "アーキテクチャパターン・メタ視点担当",
    systemPrompt: `
${DEVELOPMENT_CORE_INSTRUCTION}
あなたはMAGIシステムの一員「THEORIST」です。役割は「アーキテクチャパターンとメタ視点からの理論構築」です。
【基本姿勢】
- 個別の実装よりも、「どのような種類のシステムか」「どのパターンがはまりやすいか」を考えます。
- DDD、クリーンアーキテクチャ、イベント駆動、マイクロサービス／モノリスなどの構造を比較します。
- if 仮定を多用し、長期的な進化パスや極端なケースも検討します。
【ラウンド別のふるまい】
- ラウンド1:
  - このプロジェクトを抽象化した「典型パターン」をいくつか列挙し、
  - それぞれに適したアーキテクチャスタイルを提案してください。
- 2ラウンド目以降:
  - 他エージェントの具体案を材料に、「この設計が将来どう効いてくるか」を理論的に評価してください。
【出力フォーマット】
1. 抽象化した課題構造・類型（どんなタイプのシステムか）
2. 候補となるアーキテクチャ・パターン
3. 大胆な仮説・シナリオ（if 〜 だったら）
4. 他エージェントへの示唆（どの方向性を強めるべきか）
    `.trim(),
  },
  {
    name: "ANALYST",
    role: "統合・分析担当（要件・設計・リスクを整理する担当）",
    systemPrompt: `
${DEVELOPMENT_CORE_INSTRUCTION}
あなたはMAGIシステムの一員「ANALYST」です。役割は「各エージェントの意見を統合し、システム開発計画として整理するファシリテーター」です。
【基本姿勢】
- MELCHIOR / BALTHASAR / CASPER / THEORIST の発言を読み、
  - 要件
  - アーキテクチャ
  - リスク・制約
  - 将来拡張の方向性
  をマップとして可視化します。
- 自分の意見を増やしすぎず、「合意点・対立点・抜け漏れ」を整理して次ラウンドに渡します。
【ラウンド別のふるまい】
- ラウンド1:
  - 今後のラウンドで深掘りすべき観点（例: 認証・課金・監視など）を提示してください。
- 2ラウンド目以降:
  - 各エージェントの論点を圧縮し、
  - どの論点が収束しつつあり、どこがまだ分岐しているかを示してください。
【出力フォーマット】
1. 各エージェントの要約（MELCHIOR / BALTHASAR / CASPER / THEORIST）
2. 合意点（要件・設計・リスクごと）
3. 相違点・争点
4. 追加で検討すべき論点
5. JUDGE が検討すべき設計案・進め方の候補
    `.trim(),
  },
  {
    name: "JUDGE",
    role: "最終判断・結論担当（仕様と開発計画をまとめる担当）",
    systemPrompt: `
${DEVELOPMENT_CORE_INSTRUCTION}
あなたはMAGIシステムの一員「JUDGE」です。役割は「全ての議論を踏まえて、開発チームが動ける仕様・設計・計画をまとめる意思決定者」です。
【基本姿勢】
- MELCHIOR / BALTHASAR / CASPER / ANALYST / THEORIST の視点を踏まえ、
  - 要件定義
  - アーキテクチャ方針
  - 開発フェーズ／タスク
  - テスト戦略
  - 主要リスクと対応
  を一本のドキュメントに統合します。
- 必要に応じて「推奨案A」「代替案B」を示し、どの条件ならどちらを選ぶべきかを説明します。
【出力フォーマット（Markdown）】
- 冒頭に「## プロジェクト概要」を置き、その後に以下をこの順番で記述してください。
  - ## ユースケースとユーザーストーリー
  - ## 機能要件（優先度付き）
  - ## 非機能要件
  - ## システムアーキテクチャ
  - ## 実装計画とタスク分解
  - ## テスト戦略・品質保証
  - ## リスクと対応方針
  - ## 今後の検討事項
「実装計画とタスク分解」では、\`- [ ] タスク\` 形式のチェックリストで出力してください。
    `.trim(),
  },
];

const MODE_DEFINITIONS = Object.freeze({
  general: {
    key: "general",
    label: "汎用モード",
    description: "抽象議論・発想系のMAGIとして動作",
    agents: GENERAL_AGENTS,
    buildFirstRoundPrompt: buildGeneralFirstRoundPrompt,
    buildFollowupPrompt: buildGeneralFollowupPrompt,
    buildSummaryPrompt: buildGeneralSummaryPrompt,
  },
  development: {
    key: "development",
    label: "システム開発モード",
    description: "DEV_AGENTSが要件定義・設計会議を行うモード",
    agents: DEVELOPMENT_AGENTS,
    buildFirstRoundPrompt: buildDevelopmentFirstRoundPrompt,
    buildFollowupPrompt: buildDevelopmentFollowupPrompt,
    buildSummaryPrompt: buildDevelopmentSummaryPrompt,
  },
});

const STORAGE_AREA = chrome.storage?.session ?? chrome.storage.local;
const STORAGE_KEY = "magi_state";
const STATE_PERSIST_DEBOUNCE_MS = 250;

const state = {
  running: false,
  mode: DEFAULT_MODE_KEY,
  activeMode: null,
  topic: "",
  plannedRounds: 3,
  agentTabs: [],
  logs: [],
  roundLogs: [],
  summary: "",
  agentWindowId: null,
  stopRequested: false,
};

let keepAliveIntervalId = null;
let persistTimerId = null;
let activeWorkflowPromise = null;
let stateReadyPromise = restoreState();

function resolveModeKey(input) {
  if (!input) return null;
  const normalized = String(input).trim().toLowerCase();
  if (MODE_DEFINITIONS[normalized]) {
    return normalized;
  }
  if (normalized === "dev" || normalized === "development" || normalized === "system-development") {
    return "development";
  }
  if (normalized === "default") {
    return DEFAULT_MODE_KEY;
  }
  return null;
}

function getModeDefinition(modeKey = getEffectiveMode()) {
  if (MODE_DEFINITIONS[modeKey]) {
    return MODE_DEFINITIONS[modeKey];
  }
  return MODE_DEFINITIONS[DEFAULT_MODE_KEY];
}

function getEffectiveMode() {
  return state.activeMode || state.mode || DEFAULT_MODE_KEY;
}

function getModeLabel(modeKey) {
  const definition = getModeDefinition(modeKey);
  return definition?.label ?? "汎用モード";
}

function getAgentDefinitions(modeKey = getEffectiveMode()) {
  const definition = getModeDefinition(modeKey);
  return definition.agents;
}

chrome.runtime.onStartup.addListener(() => {
  stateReadyPromise = restoreState();
});

if (chrome.runtime.onSuspend) {
  chrome.runtime.onSuspend.addListener(() => {
    persistState().catch((error) => {
      console.warn("MAGI persist on suspend failed:", error);
    });
  });
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "START_DISCUSSION") {
    (async () => {
      try {
        await ensureStateReady();
        const topic = (message.topic || "").trim();
        const rounds = Number(message.rounds) || 3;
        const requestedMode =
          resolveModeKey(message.mode) ?? state.mode ?? DEFAULT_MODE_KEY;
        const modeKey = MODE_DEFINITIONS[requestedMode] ? requestedMode : DEFAULT_MODE_KEY;

        if (!topic) {
          sendResponse({ status: "error", message: "議題を入力してください。" });
          return;
        }

        if (state.running) {
          sendResponse({
            status: "error",
            message: "別の議論が進行中です。完了を待ってから再実行してください。",
          });
          return;
        }

        sendResponse({ status: "ok" });
        startDiscussion(topic, rounds, modeKey).catch((error) => {
          pushLog(`エラー: ${error.message}`);
          notify({ type: "DISCUSSION_ERROR", message: error.message });
        });
      } catch (error) {
        sendResponse({ status: "error", message: error.message });
      }
    })();
    return true;
  }

  if (message?.type === "GET_STATE") {
    (async () => {
      try {
        await ensureStateReady();
        sendResponse({
          status: "ok",
          state: getPublicState(),
        });
      } catch (error) {
        sendResponse({ status: "error", message: error.message });
      }
    })();
    return true;
  }

  if (message?.type === "STOP_DISCUSSION") {
    (async () => {
      try {
        await ensureStateReady();
        if (!state.running) {
          sendResponse({ status: "ok" });
          return;
        }

        state.stopRequested = true;
        pushLog("ユーザーから議論停止要求を受信しました。現在のラウンド終了後に停止します。");
        notifyState();
        sendResponse({ status: "ok" });
      } catch (error) {
        sendResponse({ status: "error", message: error.message });
      }
    })();
    return true;
  }

  if (message?.type === "SET_MODE") {
    (async () => {
      try {
        await ensureStateReady();
        const requested = resolveModeKey(message.mode) ?? DEFAULT_MODE_KEY;
        if (!MODE_DEFINITIONS[requested]) {
          sendResponse({ status: "error", message: "不明なモードが指定されました。" });
          return;
        }
        state.mode = requested;
        if (!state.running) {
          state.activeMode = null;
        }
        scheduleStatePersist();
        notifyState();
        sendResponse({ status: "ok", mode: requested });
      } catch (error) {
        sendResponse({ status: "error", message: error.message });
      }
    })();
    return true;
  }

  return undefined;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const index = state.agentTabs.findIndex((tab) => tab.tabId === tabId);
  if (index >= 0) {
    const removed = state.agentTabs[index];
    state.agentTabs.splice(index, 1);
    pushLog(`【${removed.name}】 のタブ (${tabId}) が閉じられました。必要であれば議論を再実行してください。`);
    notify({ type: "AGENT_TAB_CLOSED", tabId, agentName: removed.name });
    notifyState();
  }
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (state.agentWindowId === windowId) {
    state.agentWindowId = null;
    notifyState();
  }
});

function startKeepAlive() {
  if (keepAliveIntervalId != null) return;
  keepAliveIntervalId = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {
      const err = chrome.runtime.lastError;
      if (
        err &&
        !err.message.includes("Extension context invalidated") &&
        !err.message.includes("The message port closed before a response was received")
      ) {
        console.warn("MAGI keepAlive error:", err);
      }
    });
  }, 20_000);
}

function stopKeepAlive() {
  if (keepAliveIntervalId != null) {
    clearInterval(keepAliveIntervalId);
    keepAliveIntervalId = null;
  }
}
async function startDiscussion(topic, rounds, modeKey = getEffectiveMode()) {
  await ensureStateReady();
  await disposeAgentTabs();
  state.running = true;
  const normalizedMode = MODE_DEFINITIONS[modeKey] ? modeKey : DEFAULT_MODE_KEY;
  state.mode = normalizedMode;
  state.activeMode = normalizedMode;
  state.stopRequested = false;
  state.topic = topic;
  state.plannedRounds = rounds;
  state.roundLogs = [];
  state.summary = "";
  state.logs = [];
  state.agentTabs = [];
  scheduleStatePersist();
  const modeLabel = getModeLabel(normalizedMode);
  pushLog(`議論を開始します: 「${topic}」 (モード: ${modeLabel} / ラウンド数: ${rounds})`);
  notifyState();
  await runDiscussionWorkflow({ resume: false });
}

async function runDiscussionWorkflow({ resume = false } = {}) {
  if (!state.running) return;

  if (activeWorkflowPromise) {
    await activeWorkflowPromise;
    return;
  }

  activeWorkflowPromise = (async () => {
    startKeepAlive();
    try {
      if (resume) {
        pushLog("前回の議論状態を復元しています…");
        await prepareAgentTabs({ reuseExisting: true });
      } else {
        pushLog("エージェント用タブを準備しています…");
        await prepareAgentTabs({ reuseExisting: false });
        pushLog("各エージェントを初期化しています…");
        await initializeAgents();
      }
      if (!state.running) {
        pushLog("議論が停止されました（タブ準備後）。");
        return;
      }

      const plannedRounds = state.plannedRounds;
      pushLog(`議論ラウンドを実行します（${plannedRounds} ラウンド予定）。`);
      await executeRounds(plannedRounds, state.topic);

      if (state.summary) {
        pushLog("最終まとめは既に生成済みです。");
        return;
      }

      const hasAnyRounds = state.roundLogs.length > 0;
      if (!hasAnyRounds) {
        if (state.stopRequested) {
          pushLog("ラウンド開始前に停止要求があったため、 summary を生成せず終了します。");
        }
        return;
      }

      if (state.stopRequested) {
        pushLog("途中停止のため暫定まとめを生成します…");
      } else {
        pushLog("JUDGE による最終まとめを依頼しています…");
      }

      const summary = await requestFinalSummary(state.topic);
      state.summary = summary;
      notify({
        type: "DISCUSSION_COMPLETE",
        summary,
        rounds: state.roundLogs,
        partial: state.stopRequested,
      });
      notifyState();
      pushLog(state.stopRequested ? "暫定まとめを生成しました。" : "議論が完了しました。");
    } finally {
      state.running = false;
      state.stopRequested = false;
      state.activeMode = null;
      stopKeepAlive();
      notifyState();
    }
  })();

  try {
    await activeWorkflowPromise;
  } finally {
    activeWorkflowPromise = null;
  }
}

async function prepareAgentTabs({ reuseExisting = false } = {}) {
  if (!state.running) return;

  const originalContext = await getActiveContext();
  if (!reuseExisting) {
    await disposeAgentTabs();
  }

  const agents = getAgentDefinitions();
  const tasks = agents.map(async (agent) => {
    if (!state.running) return null;

    if (reuseExisting) {
      const existing = await reviveExistingAgentTab(agent);
      if (existing) {
        pushLog(`【${agent.name}】 既存タブを再利用します (tabId: ${existing.tabId})`);
        return existing;
      }
    }

    if (!state.running) return null;

    try {
      return await openAgentTab(agent, originalContext);
    } catch (error) {
      pushLog(`【${agent.name}】 タブ準備に失敗しました: ${error.message}`);
      return null;
    }
  });

  const preparedTabs = (await Promise.all(tasks)).filter(Boolean);

  state.agentTabs = preparedTabs;
  notifyState();
}

async function reviveExistingAgentTab(agent) {
  const existing = state.agentTabs.find((entry) => entry.name === agent.name);
  if (!existing?.tabId) {
    return null;
  }
  try {
    await getTab(existing.tabId);
    await configureTabForLongRunning(existing.tabId);
    await ensureContentReady(existing.tabId);
    return { ...agent, tabId: existing.tabId };
  } catch {
    return null;
  }
}

async function openAgentTab(agent, originalContext) {
  let windowId = await ensureAgentWindow();
  let lastError;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const tab = await createTab({
        url: CHATGPT_URL,
        active: false,
        windowId: windowId ?? undefined,
      });
      await configureTabForLongRunning(tab.id);
      await waitForTabComplete(tab.id);
      await ensureContentReady(tab.id);
      await temporarilyActivateTab(tab.id, `初期表示 (${agent.name})`, originalContext);
      await cleanupAgentWindowPlaceholders(windowId, tab.id);
      const entry = { ...agent, tabId: tab.id };
      pushLog(`【${agent.name}】 タブ準備完了 (tabId: ${tab.id})`);
      return entry;
    } catch (error) {
      lastError = error;
      if (!error?.message?.includes("No window with id") || attempt === 1) {
        throw error;
      }
      if (windowId != null) {
        state.agentWindowId = null;
        notifyState();
      }
      pushLog("専用ウィンドウが閉じられていたため、新しく作成します。");
      windowId = await ensureAgentWindow();
    }
  }

  throw lastError ?? new Error("専用ウィンドウの作成に失敗しました。");
}

async function cleanupAgentWindowPlaceholders(windowId, keepTabId) {
  if (!windowId) return;
  try {
    const tabs = await prepareChromeCall(chrome.tabs.query, { windowId });
    const targets = (tabs || [])
      .filter((tab) => tab.id != null && tab.id !== keepTabId)
      .filter((tab) => tab.url?.startsWith("chrome://newtab/") || tab.url === "chrome://newtab/");
    if (!targets.length) return;
    await Promise.all(targets.map((tab) => safeRemoveTab(tab.id)));
  } catch (error) {
    console.warn("MAGI cleanupAgentWindowPlaceholders error:", error);
  }
}

async function disposeAgentTabs() {
  if (!state.agentTabs.length) {
    return;
  }
  const tabsToClose = [...state.agentTabs];
  state.agentTabs = [];
  notifyState();
  await Promise.all(tabsToClose.map((agent) => safeRemoveTab(agent.tabId)));
}

async function ensureAgentWindow() {
  if (state.agentWindowId) {
    try {
      await prepareChromeCall(chrome.windows.get, state.agentWindowId, { populate: false });
      return state.agentWindowId;
    } catch {
      state.agentWindowId = null;
      notifyState();
    }
  }

  try {
    const win = await prepareChromeCall(chrome.windows.create, {
      focused: false,
      state: "minimized",
      url: "chrome://newtab/",
      type: "normal",
    });
    state.agentWindowId = win?.id ?? null;
    notifyState();

    const placeholderTabs = win?.tabs ?? [];
    if (placeholderTabs.length > 1) {
      const [, ...extraTabs] = placeholderTabs;
      await Promise.all(
        extraTabs
          .filter((tab) => tab.id != null)
          .map((tab) => safeRemoveTab(tab.id))
      );
    }

    return state.agentWindowId;
  } catch (error) {
    pushLog(`専用ウィンドウの作成に失敗しました: ${error.message}`);
    return null;
  }
}

async function initializeAgents() {
  for (const agent of state.agentTabs) {
    if (!state.running) return;
    try {
      await ensureTabAwake(agent, "初期化");
      const context = await getActiveContext();
      await temporarilyActivateTab(agent.tabId, `初期化 (${agent.name})`, context);
      const prompt = buildInitializationPrompt(agent);
      const response = await sendPromptToAgent(agent, prompt);
      const text = response?.text || "";
      if (text.includes(`${agent.name}、準備完了`)) {
        pushLog(`【${agent.name}】 初期化完了`);
      } else {
        pushLog(`【${agent.name}】 初期化応答: ${truncate(text)}`);
      }
    } catch (error) {
      pushLog(`【${agent.name}】 初期化に失敗しました: ${error.message}`);
    }
  }
}
async function executeRounds(rounds, topic) {
  const roundLogs = normalizeRoundLogs(state.roundLogs);
  state.roundLogs = roundLogs;

  if (roundLogs.length >= rounds) {
    return;
  }

  const allParticipantAgents = state.agentTabs.filter(
    (agent) => agent.name !== "ANALYST" && agent.name !== "JUDGE"
  );
  const analystAgent = state.agentTabs.find((agent) => agent.name === "ANALYST");
  if (!analystAgent) {
    throw new Error("ANALYSTタブが見つかりませんでした。");
  }
  const theoristAgent = allParticipantAgents.find((agent) => agent.name === "THEORIST");
  const votingAgents = theoristAgent
    ? allParticipantAgents.filter((agent) => agent.name !== "THEORIST")
    : allParticipantAgents;

  let previousAnalystSummary =
    roundLogs.length > 0 ? roundLogs[roundLogs.length - 1]?.analyst ?? "" : "";
  const modeDefinition = getModeDefinition();

  for (let round = roundLogs.length + 1; round <= rounds; round += 1) {
    if (!state.running) break;

    pushLog(`ラウンド ${round}/${rounds} を実行しています…`);

    const template =
      round === 1 && !previousAnalystSummary
        ? modeDefinition.buildFirstRoundPrompt(topic)
        : modeDefinition.buildFollowupPrompt(previousAnalystSummary, {
            topic,
            round,
            plannedRounds: rounds,
          });

    const includeTheorist = Boolean(theoristAgent && round === 1 && roundLogs.length === 0);
    const participantsForRound = includeTheorist ? allParticipantAgents : votingAgents;
    const participantResponses = await broadcastPrompt(template, participantsForRound);

    pushLog("ANALYST に前ラウンドの要約を依頼しています…");
    const analystPrompt = buildAnalystPrompt(round, participantResponses, previousAnalystSummary);
    let analystSummary = "";
    try {
      const analystResponse = await sendPromptToAgent(analystAgent, analystPrompt, 1);
      analystSummary = (analystResponse?.text || "").trim();
    } catch (error) {
      analystSummary = `【ANALYSTエラー】${error.message}`;
      pushLog(`【ANALYST】 応答取得に失敗しました: ${error.message}`);
    }
    previousAnalystSummary = analystSummary;

    const roundEntry = {
      round,
      participants: participantResponses,
      analyst: analystSummary,
    };
    roundLogs.push(roundEntry);
    state.roundLogs = roundLogs.slice();

    notify({ type: "ROUND_COMPLETE", round, responses: participantResponses, analyst: analystSummary });
    notifyState();

    if (state.stopRequested) {
      pushLog("停止要求を受信したため、次のラウンドをスキップします。");
      break;
    }

    if (round < rounds && state.running) {
      const decision = await requestConvergenceDecision({
        topic,
        roundEntry,
        round,
        remainingRounds: rounds - round,
        analystAgent,
      });
      if (decision?.decision === "STOP") {
        pushLog(`ANALYSTの収束判定: これ以上のラウンドは不要 (${decision.reason || "理由: なし"})`);
        break;
      }
      if (decision?.decision === "CONTINUE" && decision.reason) {
        pushLog(`ANALYSTの収束判定: 継続 (${decision.reason})`);
      }
    }
  }
}

async function requestFinalSummary(topic) {
  const judge = state.agentTabs.find((agent) => agent.name === "JUDGE");
  if (!judge) {
    throw new Error("JUDGEタブが見つかりませんでした。");
  }
  const prompt = getModeDefinition().buildSummaryPrompt(topic, state.roundLogs, judge);
  const response = await sendPromptToAgent(judge, prompt);
  return response.text;
}

function buildInitializationPrompt(agent) {
  return `あなたは今から「${agent.name}」として議論に参加します。

【あなたの役割】
${agent.role}

【指示】
${agent.systemPrompt}

この役割を理解したら「${agent.name}、準備完了」と応答してください。`;
}

function buildGeneralFirstRoundPrompt(topic) {
  return `【議題】
${topic}

【ルール】
- あなたは既に与えられた役割・出力フォーマットに従ってください。
- 今回はラウンド1です。あなたの視点からの初期分析と仮説を述べてください。
- 出力は日本語で、800〜1600文字程度を目安にしてください。
- 具体的アクションよりも「抽象化」「仮説」「モデル化」「反例提示」「問いの再定義」を優先してください。`;
}

function buildGeneralFollowupPrompt(previousAnalystSummary) {
  const digest = (previousAnalystSummary || "").trim() || "（前ラウンドの要約はありません）";
  return `【前ラウンドの要約】
${digest}

【タスク】
- 既に共有されているあなたの役割・ルールを前提に、
  - 同意/不同意ポイントとその理由
  - 新しい仮説・抽象モデル・反例・if仮定
  - 次ラウンドで掘るべき論点
を述べてください。
- 現実的制約は最低限にし、役割に沿った飛躍的思考を優先してください。`;
}

function buildAnalystPrompt(round, participantResponses, previousAnalystSummary) {
  const digest = formatResponses(participantResponses);
  const previous = (previousAnalystSummary || "").trim();
  const previousBlock = previous
    ? `\n【前ラウンドまでの要約】
${previous}\n`
    : "";

  return `【あなたの役割とルール】
{agent_system_prompt}

【ラウンド${round}の各エージェント発言】
${digest}
${previousBlock}
各エージェントの論点を統合し、共通点・相違点・論点の抜け漏れを整理してください。
JUDGE が判断しやすいよう、役割ごとの差分も明確にしてください。`;
}

function buildGeneralSummaryPrompt(topic, rounds, judgeAgent) {
  const digest = formatRoundHistory(rounds);

  return `${judgeAgent.systemPrompt}

【議論の総括依頼】

議題: ${topic}

全${rounds.length}ラウンドの議論が終了しました。
JUDGEとして、以下の構成で最終的なまとめを作成してください：

1. 結論の要約（1〜3行で簡潔に）
2. 理論的な枠組み・モデル化（今回の議論を抽象化したモデルやフレーム）
3. 判断の根拠（各視点からの主要なポイントを整理）
4. 推奨アクションプラン（必要な場合のみ。ステップ形式かチェックボックス形式）
5. 今後の問い・未解決点

必要に応じて「推奨案A」「代替案B」のように複数案を示し、どの条件ならどちらを選ぶべきか説明してください。

【参考】
${digest}
`;
}

function buildDevelopmentFirstRoundPrompt(topic) {
  return `【プロジェクト概要】
${topic}

【タスク】
- あなたは既に与えられた役割・出力フォーマットに従ってください。
- 今回はラウンド1です。あなたの視点から見た
  - プロジェクトのゴール
  - 想定ユーザー・ユースケース
  - 必要な機能／非機能
  - アーキテクチャやリスクの初期仮説
を整理してください。
- 出力は日本語で、800〜1600文字程度を目安にしてください。
- 抽象的な議論だけでなく、できるだけ「実際の開発に使える粒度」まで具体化してください。`;
}

function buildDevelopmentFollowupPrompt(previousAnalystSummary) {
  const digest = (previousAnalystSummary || "").trim() || "（前ラウンドの要約はありません）";
  return `【前ラウンドの要約】
${digest}

【タスク】
- 与えられた役割・フォーマットを厳守し、設計会議として具体的に議論してください。
- 今回は2ラウンド目以降です。以下を必ず盛り込んでください。
  - 他エージェントの提案に対する評価・補完・懸念
  - 要件／アーキテクチャ／リスクの抜け漏れ指摘
  - MVPスコープや段階的リリースに向けた具体的アクション
- ビジネス価値・UX・技術実現性・品質・運用性のバランスを明示してください。
- 出力は日本語で800〜1600文字を目安にし、実際の開発チームが参照できる粒度まで落とし込んでください。`;
}

function buildDevelopmentSummaryPrompt(topic, rounds, judgeAgent) {
  const digest = formatRoundHistory(rounds);

  return `${judgeAgent.systemPrompt}

【議論の総括依頼】

プロジェクト: ${topic}

全${rounds.length}ラウンドの議論が終了しました。
JUDGEとして、開発チームがそのまま参照できる仕様・設計ドキュメントを作成してください。

【出力構成（Markdown）】

1. プロジェクト概要（1〜3段落で簡潔に）
2. ユースケースとユーザーストーリー（代表的なものを列挙）
3. 機能要件（Must / Should / Could 単位で整理）
4. 非機能要件（性能・可用性・セキュリティ・運用など）
5. システムアーキテクチャ（テキストで構成図を説明）
6. 実装計画とタスク分解（\`- [ ] タスク\` 形式）
7. テスト戦略・品質保証（テストレベル・観点・自動化方針）
8. 主要リスクと対応方針
9. 今後の問い・未解決点

【参考（ラウンドログダイジェスト）】
${digest}

`;
}

function formatResponses(responses) {
  return Object.entries(responses || {})
    .map(([name, text]) => {
      const trimmed = (text || "").trim();
      return `【${name}】
${trimmed.slice(0, 800)}${trimmed.length > 800 ? "..." : ""}`;
    })
    .join("\n\n");
}

function formatRoundHistory(rounds) {
  return (rounds || [])
    .map((round, index) => {
      const roundIndex = round?.round ?? index + 1;
      const participantsDigest = formatResponses(round?.participants || {});
      const analystBlock = (round?.analyst || "").trim()
        ? `\n\n【ANALYST】
${round.analyst.trim()}`
        : "";
      return `ラウンド${roundIndex}:
${participantsDigest}${analystBlock}`;
    })
    .join("\n\n");
}

function renderTemplate(template, agent) {
  if (typeof template === "function") {
    return template(agent);
  }
  if (typeof template === "string") {
    return template
      .replace(/\{agent_role\}/g, agent.role)
      .replace(/\{agent_system_prompt\}/g, agent.systemPrompt);
  }
  return "";
}

async function requestConvergenceDecision({ topic, roundEntry, round, remainingRounds, analystAgent }) {
  if (!analystAgent || !roundEntry) return null;
  try {
    const prompt = buildConvergencePrompt(topic, roundEntry, round, remainingRounds, analystAgent);
    const response = await sendPromptToAgent(analystAgent, prompt, 0);
    return parseConvergenceDecision(response?.text || "");
  } catch (error) {
    pushLog(`収束判定の取得に失敗しました: ${error.message}`);
    return null;
  }
}

function buildConvergencePrompt(topic, roundEntry, round, remainingRounds, analystAgent) {
  const participantsDigest = formatResponses(roundEntry.participants || {});
  const analystSummary = roundEntry.analyst || "（ANALYST要約なし）";
  return `${analystAgent.systemPrompt}

【収束判定タスク】

議題: ${topic}
現在のラウンド: ${round}
残り最大ラウンド数: ${remainingRounds}

【ラウンド${round}の各エージェント発言】
${participantsDigest}

【ANALYST自身の要約】
${analystSummary}

あなたはファシリテーターとして、この時点で議論を続けるべきかを評価してください。

【回答フォーマット】
Decision: CONTINUE または STOP のどちらかを1語で記述
Reason: そう判断した理由（1〜2文）

例:
Decision: STOP
Reason: 主要論点が出揃い、JUDGEが結論可能と判断したため。`;
}

function parseConvergenceDecision(text) {
  const normalized = (text || "").trim();
  if (!normalized) return null;
  const decisionMatch = normalized.match(/Decision\s*:\s*(STOP|CONTINUE)/i);
  if (!decisionMatch) return null;
  const reasonMatch = normalized.match(/Reason\s*:\s*([^\n]+)/i);
  return {
    decision: decisionMatch[1].toUpperCase(),
    reason: reasonMatch ? reasonMatch[1].trim() : "",
  };
}
async function broadcastPrompt(template, agentList) {
  const results = {};
  const participants =
    agentList && agentList.length
      ? agentList
      : state.agentTabs.filter((agent) => agent.name !== "JUDGE");

  await Promise.all(
    participants.map(async (agent) => {
      if (!state.running) return;
      const prompt = renderTemplate(template, agent);
      try {
        const response = await sendPromptToAgent(agent, prompt);
        results[agent.name] = response.text;
        pushLog(`【${agent.name}】 応答取得`);
      } catch (error) {
        results[agent.name] = `エラー: ${error.message}`;
        pushLog(`【${agent.name}】 応答取得に失敗しました: ${error.message}`);
      }
    })
  );

  return results;
}

async function sendPromptToAgent(agent, prompt, maxRetry = 1) {
  let lastError;
  const stopPeriodicActivation = startPeriodicActivation(agent, "応答待機");
  try {
    for (let attempt = 0; attempt <= maxRetry; attempt += 1) {
      if (!state.running) {
        throw new Error("議論が停止されました。");
      }

      try {
        await ensureTabAwake(agent, "メッセージ送信");
        const response = await sendMessageToTab(agent.tabId, {
          type: "SEND_PROMPT",
          prompt,
          agentName: agent.name,
          timeout: RESPONSE_TIMEOUT_MS,
        });

        if (response?.status !== "ok") {
          throw new Error(response?.error ?? "不明なエラー");
        }

        return response.data;
      } catch (error) {
        lastError = error;
        if (attempt < maxRetry && isTransientError(error)) {
          pushLog(
            `【${agent.name}】 応答取得失敗（リトライ ${attempt + 1}/${maxRetry + 1}）: ${error.message}`
          );
          await delay(1000 * (attempt + 1));
          continue;
        }
        break;
      }
    }
  } finally {
    stopPeriodicActivation();
  }

  throw new Error(`【${agent.name}】 応答取得に失敗しました: ${lastError?.message ?? "不明なエラー"}`);
}
async function ensureContentReady(tabId) {
  const start = Date.now();
  while (Date.now() - start < CONTENT_READY_TIMEOUT_MS) {
    try {
      const ping = await sendMessageToTab(tabId, { type: "PING" });
      if (ping?.status === "ok") {
        return;
      }
    } catch (error) {
      if (!isNoReceivingEndError(error)) {
        throw error;
      }
    }
    await delay(1000);
  }
  throw new Error("コンテンツスクリプトの初期化に失敗しました。");
}

async function waitForTabComplete(tabId) {
  const tab = await getTab(tabId);
  if (!tab) {
    throw new Error(`tabId ${tabId} が見つかりませんでした。`);
  }
  if (tab.status === "complete") {
    return;
  }

  await new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("タブの読み込みがタイムアウトしました。"));
    }, TAB_LOAD_TIMEOUT_MS);

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        cleanup();
        resolve();
      }
    };

    const cleanup = () => {
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(listener);
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function prepareChromeCall(fn, ...args) {
  return new Promise((resolve, reject) => {
    try {
      fn(...args, (result) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        resolve(result);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function createTab(options) {
  return prepareChromeCall(chrome.tabs.create, options);
}

function safeRemoveTab(tabId) {
  if (!tabId) return Promise.resolve();
  return prepareChromeCall(chrome.tabs.remove, tabId).catch(() => undefined);
}

function getTab(tabId) {
  return prepareChromeCall(chrome.tabs.get, tabId);
}

function sendMessageToTab(tabId, payload) {
  return new Promise((resolve, reject) => {
    try {
      chrome.tabs.sendMessage(tabId, payload, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
}
function pushLog(message) {
  const entry = {
    timestamp: new Date().toISOString(),
    message,
  };
  state.logs.push(entry);
  if (state.logs.length > MAX_LOG_ENTRIES) {
    state.logs.splice(0, state.logs.length - MAX_LOG_ENTRIES);
  }
  scheduleStatePersist();
  notify({ type: "LOG", entry });
  console.log("[MAGI]", message);
}

function notify(event) {
  try {
    chrome.runtime.sendMessage(event, () => {
      const err = chrome.runtime.lastError;
      if (
        err &&
        !err.message.includes("Receiving end does not exist") &&
        !err.message.includes("The message port closed before a response was received")
      ) {
        console.warn("MAGI notify error:", err);
      }
    });
  } catch (error) {
    console.warn("MAGI notify error (sync):", error);
  }
}

function getPublicState() {
  const effectiveMode = getEffectiveMode();
  return {
    running: state.running,
    mode: state.mode ?? DEFAULT_MODE_KEY,
    activeMode: state.activeMode,
    effectiveMode,
    modeLabel: getModeLabel(effectiveMode),
    topic: state.topic,
    plannedRounds: state.plannedRounds,
    logs: state.logs,
    roundLogs: state.roundLogs,
    summary: state.summary,
    agents: state.agentTabs.map(({ name, tabId }) => ({ name, tabId })),
    stopRequested: state.stopRequested,
  };
}

function notifyState() {
  const publicState = getPublicState();
  scheduleStatePersist();
  notify({
    type: "STATE_UPDATE",
    state: publicState,
  });
}

function truncate(text, max = 120) {
  if (!text) return "";
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNoReceivingEndError(error) {
  if (!error?.message) return false;
  return (
    error.message.includes("Receiving end does not exist") ||
    error.message.includes("No tab with id") ||
    error.message.includes("Could not establish connection. Receiving end does not exist.")
  );
}

function isTransientError(error) {
  if (!error?.message) return false;
  const msg = error.message;
  return (
    isNoReceivingEndError(error) ||
    msg.includes("The message port closed before a response was received") ||
    msg.includes("ChatGPTの応答待ちがタイムアウトしました")
  );
}

function startPeriodicActivation(agent, reason) {
  if (!TAB_REFOCUS_INTERVAL_MS || TAB_REFOCUS_INTERVAL_MS <= 0) {
    return () => {};
  }

  let cancelled = false;
  let timerId = null;

  const tick = async () => {
    if (cancelled || !state.running) {
      return;
    }
    try {
      await temporarilyActivateTab(agent.tabId, `${reason}（バックアップ）`);
    } catch (error) {
      pushLog(`【${agent.name}】 定期アクティブ化でエラー: ${error.message}`);
    } finally {
      if (!cancelled) {
        timerId = setTimeout(tick, TAB_REFOCUS_INTERVAL_MS);
      }
    }
  };

  timerId = setTimeout(tick, TAB_REFOCUS_INTERVAL_MS);

  return () => {
    cancelled = true;
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
  };
}

async function configureTabForLongRunning(tabId) {
  try {
    await prepareChromeCall(chrome.tabs.update, tabId, {
      muted: true,
      autoDiscardable: false,
    });
  } catch (error) {
    pushLog(`タブ${tabId}のスリープ防止設定に失敗: ${error.message}`);
  }
}

async function ensureTabAwake(agent, context) {
  try {
    const tab = await getTab(agent.tabId);
    if (!tab) {
      throw new Error("タブ情報を取得できませんでした");
    }

    if (tab.discarded) {
      pushLog(`【${agent.name}】 タブがスリープ状態のため再読み込みします（${context}）`);
      await prepareChromeCall(chrome.tabs.reload, agent.tabId, { bypassCache: false });
      await waitForTabComplete(agent.tabId);
      await ensureContentReady(agent.tabId);
    } else if (tab.status !== "complete") {
      pushLog(`【${agent.name}】 タブ状態: ${tab.status}（${context}）。読み込み完了を待機します。`);
      await waitForTabComplete(agent.tabId);
      await ensureContentReady(agent.tabId);
    }
  } catch (error) {
    pushLog(`【${agent.name}】 タブ状態確認に失敗（${context}）: ${error.message}`);
    throw error;
  }
}

async function getActiveContext() {
  try {
    const tabs = await prepareChromeCall(chrome.tabs.query, {
      active: true,
      lastFocusedWindow: true,
    });
    const tab = tabs?.[0];
    if (!tab) return { tabId: null, windowId: null };
    return { tabId: tab.id ?? null, windowId: tab.windowId ?? null };
  } catch {
    return { tabId: null, windowId: null };
  }
}

async function temporarilyActivateTab(tabId, reason = "", fallbackContext = null) {
  if (!tabId) return;
  try {
    const targetTab = await getTab(tabId);
    const previousContext = fallbackContext ?? (await getActiveContext());
    const targetWindowId = targetTab?.windowId ?? null;
    const isDedicatedWindow =
      state.agentWindowId != null && targetWindowId === state.agentWindowId;

    if (reason) {
      pushLog(`タブ(${tabId})を一時的に前面表示します: ${reason}`);
    }

    if (targetWindowId != null) {
      await prepareChromeCall(chrome.windows.update, targetWindowId, { focused: true });
    }

    await prepareChromeCall(chrome.tabs.update, tabId, { active: true });
    await delay(TAB_ACTIVATION_DURATION_MS);

    if (
      previousContext?.tabId &&
      previousContext.tabId !== tabId
    ) {
      if (previousContext.windowId != null) {
        await prepareChromeCall(chrome.windows.update, previousContext.windowId, {
          focused: true,
        });
      }
      await prepareChromeCall(chrome.tabs.update, previousContext.tabId, { active: true });
    }

    if (isDedicatedWindow && targetWindowId != null) {
      try {
        await prepareChromeCall(chrome.windows.update, targetWindowId, { state: "minimized" });
      } catch {
        // ignore
      }
    }
  } catch (error) {
    pushLog(`タブ${tabId}のアクティブ化でエラー: ${error.message}`);
  }
}

async function ensureStateReady() {
  if (!stateReadyPromise) {
    return;
  }
  try {
    await stateReadyPromise;
  } catch (error) {
    console.warn("MAGI state restoration failed:", error);
  }
}

function resumeDiscussionFlow() {
  if (!state.running) return;
  if (activeWorkflowPromise) return;

  runDiscussionWorkflow({ resume: true }).catch((error) => {
    pushLog(`復元中にエラーが発生しました: ${error.message}`);
    notify({ type: "DISCUSSION_ERROR", message: error.message });
  });
}

async function restoreState() {
  if (!STORAGE_AREA) {
    return;
  }
  try {
    const stored = await storageGet(STORAGE_AREA, STORAGE_KEY);
    const snapshot = stored?.[STORAGE_KEY];
    if (!snapshot) {
      return;
    }
    applyStateSnapshot(snapshot);
    notifyState();
    if (state.running) {
      resumeDiscussionFlow();
    }
  } catch (error) {
    console.warn("MAGI state restore error:", error);
  }
}

function applyStateSnapshot(snapshot) {
  state.running = Boolean(snapshot.running);
  const storedMode = resolveModeKey(snapshot.mode) ?? DEFAULT_MODE_KEY;
  const storedActiveMode = resolveModeKey(snapshot.activeMode) ?? (state.running ? storedMode : null);
  state.mode = storedMode;
  state.activeMode = storedActiveMode;
  state.topic = snapshot.topic ?? "";
  state.plannedRounds = Number(snapshot.plannedRounds) || 3;
  state.roundLogs = normalizeRoundLogs(snapshot.roundLogs);
  state.summary = snapshot.summary ?? "";
  state.logs = Array.isArray(snapshot.logs)
    ? snapshot.logs.slice(-MAX_LOG_ENTRIES)
    : [];
  state.agentWindowId = snapshot.agentWindowId ?? null;
  state.stopRequested = Boolean(snapshot.stopRequested);
  state.agentTabs = hydrateAgentTabs(snapshot.agentTabs, storedActiveMode || storedMode);
}

function hydrateAgentTabs(savedTabs, modeKey = DEFAULT_MODE_KEY) {
  if (!Array.isArray(savedTabs)) {
    return [];
  }
  const agents = getAgentDefinitions(modeKey);
  return savedTabs
    .map((entry) => {
      if (!entry?.name || !entry?.tabId) {
        return null;
      }
      const definition = agents.find((agent) => agent.name === entry.name);
      if (!definition) {
        return null;
      }
      return { ...definition, tabId: entry.tabId };
    })
    .filter(Boolean);
}

function normalizeRoundLogs(rawRounds) {
  if (!Array.isArray(rawRounds)) {
    return [];
  }
  return rawRounds.map((entry, index) => {
    if (entry && typeof entry === "object" && "participants" in entry) {
      return {
        round: entry.round ?? index + 1,
        participants: entry.participants ?? {},
        analyst: entry.analyst ?? "",
      };
    }

    const participants = { ...(entry || {}) };
    const analyst = participants.ANALYST ?? participants.analyst ?? "";
    delete participants.ANALYST;
    delete participants.analyst;

    return {
      round: index + 1,
      participants,
      analyst,
    };
  });
}

async function persistState() {
  if (!STORAGE_AREA) {
    return;
  }
  const snapshot = serializeState();
  try {
    await storageSet(STORAGE_AREA, { [STORAGE_KEY]: snapshot });
  } catch (error) {
    console.warn("MAGI state persist error:", error);
  }
}

function serializeState() {
  return {
    running: state.running,
    mode: state.mode,
    activeMode: state.activeMode,
    topic: state.topic,
    plannedRounds: state.plannedRounds,
    agentTabs: state.agentTabs.map(({ name, tabId }) => ({ name, tabId })),
    agentWindowId: state.agentWindowId ?? null,
    logs: state.logs,
    roundLogs: state.roundLogs,
    summary: state.summary,
    stopRequested: state.stopRequested,
  };
}

function scheduleStatePersist() {
  if (!STORAGE_AREA) return;
  if (persistTimerId != null) return;
  persistTimerId = setTimeout(() => {
    persistTimerId = null;
    persistState();
  }, STATE_PERSIST_DEBOUNCE_MS);
}

function storageGet(area, keys) {
  return new Promise((resolve, reject) => {
    try {
      area.get(keys, (result) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        resolve(result);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function storageSet(area, items) {
  return new Promise((resolve, reject) => {
    try {
      area.set(items, () => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

