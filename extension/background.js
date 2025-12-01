"use strict";

const CHATGPT_URL = "https://chatgpt.com/";
const RESPONSE_TIMEOUT_MS = 600_000;
const TAB_LOAD_TIMEOUT_MS = 60_000;
const CONTENT_READY_TIMEOUT_MS = 60_000;
const TAB_ACTIVATION_DURATION_MS = 2_000;
const MAX_LOG_ENTRIES = 500;

const AGENTS = [
  {
    name: "MELCHIOR",
    role: "楽観的・可能性重視の視点（チャンスやアイデアを多く出す担当）",
    systemPrompt: `
あなたはMAGIシステムの一員「MELCHIOR」です。役割は「楽観的で可能性を重視するストラテジスト」です。

【基本姿勢】
- 物事のポジティブな側面、成長機会、新しいチャンスにフォーカスします。
- 「実現できるとしたらどうするか？」の前提で発想し、制約より可能性を優先します。
- 抽象論ではなく、すぐ試せる具体的なアイデアやアクションを3〜5個提示します。

【ラウンド別のふるまい】
- プロンプト本文に「【前ラウンドの議論】」という見出しが含まれていなければ、前ラウンド情報が無い（ラウンド1）とみなしてください。
- 前ラウンド情報が無い場合（ラウンド1想定）は、議題のポジティブな解釈・想定ユーザーのチャンス・初期アクション案を構造的に提示してください。
- 前ラウンド情報がある場合は、他エージェントの意見のうち前向きに伸ばせる点を強調し、さらに発展させる具体案を提案してください。

【出力形式】
1. 前提（どう解釈したか）
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
あなたはMAGIシステムの一員「BALTHASAR」です。役割は「慎重でリスクを重視する批判的アナリスト」です。

【基本姿勢】
- 発生しうるリスク・問題点・不確実性を列挙し、それぞれの影響度（小/中/大）と発生可能性（低/中/高）を簡潔に評価します。
- 否定だけで終わらず、可能な範囲で「回避策・緩和策」もセットで提示します。

【ラウンド別のふるまい】
- プロンプト本文に「【前ラウンドの議論】」という見出しが含まれていなければ、前ラウンド情報が無い（ラウンド1）とみなしてください。
- 前ラウンド情報が無い場合は、典型的な失敗パターン・原因・回避に必要な前提条件を整理してください。
- 前ラウンド情報がある場合は、他エージェントの提案の前提の甘さや盲点を指摘し、それでも実行するなら守るべき「安全ライン」を示してください。

【出力形式】
1. 主な懸念点（概要）
2. リスク一覧（内容／影響度／発生可能性）
3. 想定される最悪ケース
4. 対策・前提条件

AIであることへの言及やキャラクター説明は不要です。
    `.trim(),
  },
  {
    name: "CASPER",
    role: "中立・技術的視点（実現可能性と実務を評価する担当）",
    systemPrompt: `
あなたはMAGIシステムの一員「CASPER」です。役割は「感情を排した中立な技術・実務担当」です。

【基本姿勢】
- 事実・データ・論理に基づき、賛否をフラットに整理します。
- 不明点は「前提」「仮定」として明示し、選択肢ごとのトレードオフを比較します。
- 感情的な表現や価値判断は避け、専門家メモのように淡々と記述します。

【ラウンド別のふるまい】
- プロンプト本文に「【前ラウンドの議論】」という見出しが含まれていなければ、前ラウンド情報が無い（ラウンド1）とみなしてください。
- 前ラウンド情報が無い場合は、技術・実務の論点整理、主な選択肢、コスト構造や難易度をまとめてください。
- 前ラウンド情報がある場合は、他エージェントの提案を踏まえ、実行可能性・工数・リスクを考慮した現実的な落とし所を提案してください。

【出力形式】
1. 前提と仮定
2. 技術・実務的な論点整理
3. 主な選択肢とトレードオフ
4. 現時点で妥当と思われる進め方

AIであることへの言及やキャラクター説明は不要です。
    `.trim(),
  },
  {
    name: "ANALYST",
    role: "統合・分析担当（論点を整理し合意点・対立点を見える化する担当）",
    systemPrompt: `
あなたはMAGIシステムの一員「ANALYST」です。役割は「各エージェントの意見を統合し、論点を構造化するファシリテーター」です。

【基本姿勢】
- MELCHIOR / BALTHASAR / CASPER の発言を読み、共通点・相違点・見落としを整理します。
- 自分の意見を増やしすぎず、メタ視点から整理・再構成することを主とします。

【ラウンド別のふるまい】
- プロンプト本文に「【前ラウンドの議論】」という見出しが含まれていなければ、前ラウンド情報が無い（ラウンド1）とみなしてください。
- 前ラウンド情報が無い場合は、この議題で後続ラウンドが議論すべき観点と論点マップを提示してください。
- 前ラウンド情報がある場合は、各エージェントの要約、合意点／相違点、追加で検討すべき論点、JUDGEが判断しやすい候補打ち手を整理してください。

【出力形式】
1. 各エージェントの要約
2. 合意点
3. 相違点・争点
4. 追加で検討すべき論点
5. 候補となる打ち手の整理

AIであることへの言及やキャラクター説明は不要です。
    `.trim(),
  },
  {
    name: "JUDGE",
    role: "最終判断・結論担当（最終的な方針とアクションを決める担当）",
    systemPrompt: `
あなたはMAGIシステムの一員「JUDGE」です。役割は「全ての議論を踏まえて、バランスの取れた最終結論と提案を出す意思決定者」です。

【基本姿勢】
- MELCHIOR / BALTHASAR / CASPER / ANALYST の視点を踏まえ、現実的でバランスの良い方針を1つ以上提示します。
- 必要に応じて「推奨案A」「代替案B」を示し、どの条件ならどちらを選ぶべきかも説明します。
- 結論だけでなく、その判断に至った根拠を簡潔に示します。

【出力形式】
1. 結論の要約（最初に1〜3行）
2. 判断の根拠（各視点からの要点）
3. 推奨アクションプラン（ステップ形式）
4. 今後のフォローアップ・注意点

AIであることへの言及やキャラクター説明は不要です。
    `.trim(),
  },
];

const state = {
  running: false,
  topic: "",
  plannedRounds: 3,
  agentTabs: [],
  logs: [],
  roundLogs: [],
  summary: "",
};

let keepAliveIntervalId = null;
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "START_DISCUSSION") {
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
    return;
  }

  if (message?.type === "GET_STATE") {
    sendResponse({
      status: "ok",
      state: getPublicState(),
    });
    return;
  }

  if (message?.type === "STOP_DISCUSSION") {
    if (!state.running) {
      sendResponse({ status: "ok" });
      return;
    }

    state.running = false;
    pushLog("ユーザーから議論停止要求を受信しました。現在のラウンド終了後に停止します。");
    notifyState();
    sendResponse({ status: "ok" });
    return;
  }
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
  state.running = true;
  state.topic = topic;
  state.plannedRounds = rounds;
  state.roundLogs = [];
  state.summary = "";
  state.logs = [];
  pushLog(`議論を開始します: 「${topic}」 (ラウンド数: ${rounds})`);
  notifyState();
  startKeepAlive();

  try {
    pushLog("エージェント用タブを準備しています…");
    await prepareAgentTabs();
    if (!state.running) {
      pushLog("議論が停止されました（タブ準備後）。");
      return;
    }

    pushLog("各エージェントの役割を初期化しています…");
    await initializeAgents();
    if (!state.running) {
      pushLog("議論が停止されました（初期化後）。");
      return;
    }

    pushLog(`議論ラウンドを実行します（${rounds} ラウンド予定）。`);
    await executeRounds(rounds, topic);
    if (!state.running) {
      pushLog("議論はユーザーにより停止されました。最終まとめは生成しません。");
      return;
    }

    pushLog("JUDGE による最終まとめを依頼しています…");
    const summary = await requestFinalSummary(topic);
    state.summary = summary;
    notify({
      type: "DISCUSSION_COMPLETE",
      summary,
      rounds: state.roundLogs,
    });
    pushLog("議論が完了しました。");
  } finally {
    state.running = false;
    stopKeepAlive();
    notifyState();
  }
}

async function prepareAgentTabs() {
  await Promise.all(state.agentTabs.map((agent) => safeRemoveTab(agent.tabId)));
  state.agentTabs = [];

  const originalActiveTabId = await getActiveTabId();

  for (const agent of AGENTS) {
    if (!state.running) return;
    const tab = await createTab({ url: CHATGPT_URL, active: false });
    await configureTabForLongRunning(tab.id);
    await waitForTabComplete(tab.id);
    await ensureContentReady(tab.id);
    await temporarilyActivateTab(tab.id, `初期表示 (${agent.name})`, originalActiveTabId);
    state.agentTabs.push({ ...agent, tabId: tab.id });
    pushLog(`【${agent.name}】 タブ準備完了 (tabId: ${tab.id})`);
  }
}

async function initializeAgents() {
  for (const agent of state.agentTabs) {
    if (!state.running) return;
    try {
      await ensureTabAwake(agent, "初期化");
      await temporarilyActivateTab(agent.tabId, `初期化 (${agent.name})`);
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
  const roundLogs = [];
  for (let round = 1; round <= rounds; round += 1) {
    if (!state.running) break;

    pushLog(`ラウンド ${round}/${rounds} を実行しています…`);

    const template =
      round === 1
        ? buildFirstRoundPrompt(topic)
        : buildFollowupPrompt(roundLogs[roundLogs.length - 1] || {});

    const responses = await broadcastPrompt(template);
    roundLogs.push(responses);
    state.roundLogs = roundLogs;

    notify({ type: "ROUND_COMPLETE", round, responses });
  }
}

async function requestFinalSummary(topic) {
  const judge = state.agentTabs.find((agent) => agent.name === "JUDGE");
  if (!judge) {
    throw new Error("JUDGEタブが見つかりませんでした。");
  }
  const prompt = buildSummaryPrompt(topic, state.roundLogs);
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

あなたの視点（{agent_role}）から、この議題について意見を述べてください。
- 出力は日本語で、400〜800文字程度を目安にしてください。
- 箇条書きや見出しを用いて、後続ラウンドで扱いやすいよう構造化してください。
- 与えられた役割に忠実に、他のエージェントとは明確に異なる視点を示してください。`;
}

function buildFollowupPrompt(previousResponses) {
  const digest = formatResponses(previousResponses);
  return `【前ラウンドの議論】
${digest}

上記の議論を踏まえて、あなたの視点（{agent_role}）から
- 同意できる点／できない点
- 追加で指摘すべき論点
- 具体的な次の一手（あれば）
を述べてください。自分の役割に沿ってコメントし、必要に応じて他エージェントの名前を挙げて構いません。`;
}

function buildSummaryPrompt(topic, rounds) {
  const digest = rounds
    .map((round, index) => `ラウンド${index + 1}:
${formatResponses(round)}`)
    .join("\n\n");

  return `【議論の総括依頼】

議題: ${topic}

全${rounds.length}ラウンドの議論が終了しました。
JUDGEとして、以下の構成で最終的なまとめを作成してください：

1. 結論の要約（1〜3行で簡潔に）
2. 判断の根拠（各視点からの主要なポイントを整理）
3. 推奨アクションプラン（ステップ形式）
4. 今後のフォローアップ・注意点

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
async function broadcastPrompt(template) {
  const results = {};
  const participants = state.agentTabs.filter((agent) => agent.name !== "JUDGE");

  await Promise.all(
    participants.map(async (agent) => {
      if (!state.running) return;

      const prompt = template.replace("{agent_role}", agent.role);
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
  };
}

function notifyState() {
  notify({
    type: "STATE_UPDATE",
    state: getPublicState(),
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

async function getActiveTabId() {
  try {
    const tabs = await prepareChromeCall(chrome.tabs.query, {
      active: true,
      currentWindow: true,
    });
    return tabs?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function temporarilyActivateTab(tabId, reason = "", preferredReturnTabId = null) {
  if (!tabId) return;
  try {
    const previous = preferredReturnTabId ?? (await getActiveTabId());
    if (reason) {
      pushLog(`タブ(${tabId})を一時的に前面表示します: ${reason}`);
    }
    await prepareChromeCall(chrome.tabs.update, tabId, { active: true });
    await delay(TAB_ACTIVATION_DURATION_MS);
    if (previous && previous !== tabId) {
      await prepareChromeCall(chrome.tabs.update, previous, { active: true });
    }
  } catch (error) {
    pushLog(`タブ${tabId}のアクティブ化でエラー: ${error.message}`);
  }
}
