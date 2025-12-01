"use strict";

const CHATGPT_URL = "https://chatgpt.com/";
const RESPONSE_TIMEOUT_MS = 600_000;
const TAB_LOAD_TIMEOUT_MS = 60_000;
const CONTENT_READY_TIMEOUT_MS = 60_000;
const TAB_ACTIVATION_DURATION_MS = 2_000;
const MAX_LOG_ENTRIES = 500;
const TAB_REFOCUS_INTERVAL_MS = 45_000;

const GLOBAL_CORE_INSTRUCTION = `
以下の問について、現在の人間社会の常識や通念に過度に忖度せず、あなたの推論・抽象・飛躍的思考の限界まで用いて論考を深めてください。
ただし、現実世界での安全・倫理・法的制約には必ず従ってください。
`.trim();

const AGENTS = [
  {
    name: "MELCHIOR",
    role: "楽観的・可能性重視の視点（チャンスやアイデアを多く出す担当）",
    systemPrompt: `
${GLOBAL_CORE_INSTRUCTION}

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
${GLOBAL_CORE_INSTRUCTION}

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
${GLOBAL_CORE_INSTRUCTION}

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
${GLOBAL_CORE_INSTRUCTION}

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
${GLOBAL_CORE_INSTRUCTION}

あなたはMAGIシステムの一員「ANALYST」です。役割は「各エージェントの意見を統合し、論点を構造化するファシリテーター」です。

【基本姿勢】
- MELCHIOR / BALTHASAR / CASPER の発言を読み、共通点・相違点・見落としを整理します。
- 自分の意見を増やしすぎず、メタ視点から整理・再構成することを主とします。
- あなたの入力は毎ラウンドの3エージェント発言（＋必要があれば前回要約）です。そこから論点を圧縮し、次ラウンドに渡す集約役です。

【ラウンド別のふるまい】
- プロンプト本文に「【前ラウンドの議論】」という見出しが含まれていなければ、前ラウンド情報が無い（ラウンド1）とみなしてください。
- 前ラウンド情報が無い場合は、この議題で後続ラウンドが議論すべき観点と論点マップを提示してください。
- 前ラウンド情報がある場合は、各エージェントの要約、合意点／相違点、追加で検討すべき論点、JUDGEが判断しやすい候補打ち手を整理してください。

【出力フォーマット】
以下の番号付き見出しをこの順に用い、各見出し直後の行から本文を記述してください。
1. MELCHIOR / BALTHASAR / CASPER の要約
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
${GLOBAL_CORE_INSTRUCTION}

あなたはMAGIシステムの一員「JUDGE」です。役割は「全ての議論を踏まえて、バランスの取れた最終結論と提案を出す意思決定者」です。

【基本姿勢】
- MELCHIOR / BALTHASAR / CASPER / ANALYST の視点を踏まえ、現実的でバランスの良い方針を1つ以上提示します。
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

const STORAGE_AREA = chrome.storage?.session ?? chrome.storage.local;
const STORAGE_KEY = "magi_state";
const STATE_PERSIST_DEBOUNCE_MS = 250;

const state = {
  running: false,
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
        startDiscussion(topic, rounds).catch((error) => {
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
async function startDiscussion(topic, rounds) {
  await ensureStateReady();
  await disposeAgentTabs();
  state.running = true;
  state.stopRequested = false;
  state.topic = topic;
  state.plannedRounds = rounds;
  state.roundLogs = [];
  state.summary = "";
  state.logs = [];
  state.agentTabs = [];
  scheduleStatePersist();
  pushLog(`議論を開始します: 「${topic}」 (ラウンド数: ${rounds})`);
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

  const tasks = AGENTS.map(async (agent) => {
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

  const participantAgents = state.agentTabs.filter(
    (agent) => agent.name !== "ANALYST" && agent.name !== "JUDGE"
  );
  const analystAgent = state.agentTabs.find((agent) => agent.name === "ANALYST");
  if (!analystAgent) {
    throw new Error("ANALYSTタブが見つかりませんでした。");
  }

  let previousAnalystSummary =
    roundLogs.length > 0 ? roundLogs[roundLogs.length - 1]?.analyst ?? "" : "";

  for (let round = roundLogs.length + 1; round <= rounds; round += 1) {
    if (!state.running) break;

    pushLog(`ラウンド ${round}/${rounds} を実行しています…`);

    const template =
      round === 1 && !previousAnalystSummary
        ? buildFirstRoundPrompt(topic)
        : buildFollowupPrompt(previousAnalystSummary);

    const participantResponses = await broadcastPrompt(template, participantAgents);

    pushLog("ANALYST に前ラウンドの要約を依頼しています…");
    const analystPrompt = buildAnalystPrompt(round, participantResponses, previousAnalystSummary);
    const analystResponse = await sendPromptToAgent(analystAgent, analystPrompt, 1);
    const analystSummary = (analystResponse?.text || "").trim();
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
  }
}

async function requestFinalSummary(topic) {
  const judge = state.agentTabs.find((agent) => agent.name === "JUDGE");
  if (!judge) {
    throw new Error("JUDGEタブが見つかりませんでした。");
  }
  const prompt = buildSummaryPrompt(topic, state.roundLogs, judge);
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

function buildFirstRoundPrompt(topic) {
  return `【議題】
${topic}

【あなたの役割とルール】
{agent_system_prompt}

あなたの視点（{agent_role}）から、この議題について論考を述べてください。
- 出力は日本語で、800〜1600文字程度を目安にしてください。
- 具体的なアクションよりも、「抽象化」「仮説」「モデル化」「反例提示」「問いの再定義」を優先してください。
- 与えられた役割に忠実に、他エージェントとは明確に異なる視点や飛躍を示してください。`;
}

function buildFollowupPrompt(previousAnalystSummary) {
  const digest = (previousAnalystSummary || "").trim() || "（前ラウンドの要約はありません）";
  return `【前ラウンドのANALYST要約】
${digest}

【あなたの役割とルール】
{agent_system_prompt}

上記の要約を踏まえて、あなたの視点（{agent_role}）から
- 同意できる点／できない点とその理由（必要なら前提条件も明記）
- 新たに導ける仮説・抽象モデル・反例・if仮定
- 次に掘るべき問いや、他エージェントへの示唆
を述べてください。現実的制約は最低限にし、役割に沿った飛躍的思考を優先してください。`;
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

function buildSummaryPrompt(topic, rounds, judgeAgent) {
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
  return {
    running: state.running,
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
    msg.includes("The message port closed before a response was received")
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
  state.topic = snapshot.topic ?? "";
  state.plannedRounds = Number(snapshot.plannedRounds) || 3;
  state.roundLogs = normalizeRoundLogs(snapshot.roundLogs);
  state.summary = snapshot.summary ?? "";
  state.logs = Array.isArray(snapshot.logs)
    ? snapshot.logs.slice(-MAX_LOG_ENTRIES)
    : [];
  state.agentWindowId = snapshot.agentWindowId ?? null;
  state.stopRequested = Boolean(snapshot.stopRequested);
  state.agentTabs = hydrateAgentTabs(snapshot.agentTabs);
}

function hydrateAgentTabs(savedTabs) {
  if (!Array.isArray(savedTabs)) {
    return [];
  }
  return savedTabs
    .map((entry) => {
      if (!entry?.name || !entry?.tabId) {
        return null;
      }
      const definition = AGENTS.find((agent) => agent.name === entry.name);
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

