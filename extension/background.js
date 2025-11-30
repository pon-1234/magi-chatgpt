"use strict";

const CHATGPT_URL = "https://chatgpt.com/";
const RESPONSE_TIMEOUT_MS = 600_000;
const TAB_LOAD_TIMEOUT_MS = 60_000;
const CONTENT_READY_TIMEOUT_MS = 60_000;
const MAX_LOG_ENTRIES = 1_000;
const CORE_AGENT_NAMES = new Set(["MELCHIOR", "BALTHASAR", "CASPER"]);
const ANALYST_NAME = "ANALYST";
const JUDGE_NAME = "JUDGE";
const INITIALIZATION_ACTIVE_DURATION_MS = 2_500;

const DEFAULT_AGENTS = [
  {
    name: "MELCHIOR",
    role: "楽観的・可能性重視の視点",
    systemPrompt:
      "あなたはMELCHIORです。物事の良い面、可能性、チャンスに焦点を当てて議論してください。建設的で前向きな視点を提供します。",
    roundInstruction:
      "常に具体的な『新しいチャンス』『実現するためのステップ』『期待されるインパクト』を最低3点提示してください。",
  },
  {
    name: "BALTHASAR",
    role: "慎重・リスク重視の視点",
    systemPrompt:
      "あなたはBALTHASARです。リスク、問題点、懸念事項に焦点を当てて議論してください。批判的思考で潜在的な問題を指摘します。",
    roundInstruction:
      "必ず『リスク内容』『発生確率（低/中/高）』『影響度（低/中/高）』『回避・緩和策』の4項目で箇条書きにしてください。",
  },
  {
    name: "CASPER",
    role: "中立・技術的視点",
    systemPrompt:
      "あなたはCASPERです。感情を排し、データと論理に基づいて客観的に分析してください。技術的・実務的な観点を重視します。",
    roundInstruction:
      "事実・データ・実績の引用を意識し、『前提』『分析』『示唆』の3段構成で答えてください。必要に応じて数値例を挙げてください。",
  },
  {
    name: "ANALYST",
    role: "統合・分析担当",
    systemPrompt:
      "あなたはANALYSTです。他の議論参加者の意見を統合し、共通点と相違点を整理してください。議論の構造化を担当します。",
    roundInstruction:
      "各エージェントの主張を比較し、①合意点 ②相違点 ③次ラウンドで深掘りすべき論点 を箇条書きで要約してください。",
  },
  {
    name: "JUDGE",
    role: "最終判断・結論担当",
    systemPrompt:
      "あなたはJUDGEです。全ての議論を踏まえて、バランスの取れた最終的な結論や提案を導き出してください。",
    roundInstruction:
      "Markdown形式で [主要な論点 / 合意された点 / 意見が分かれた点 / 推奨する結論・次のアクション] の4セクションを構成してください。",
  },
];

const state = {
  running: false,
  topic: "",
  plannedRounds: 3,
  agentConfigs: DEFAULT_AGENTS,
  agentTabs: [],
  logs: [],
  roundLogs: [],
  summary: "",
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "START_DISCUSSION") {
    const topic = (message.topic || "").trim();
    const rounds = Number(message.rounds) || 3;
    startDiscussion(topic, rounds)
      .then((result) => sendResponse({ status: "ok", result }))
      .catch((error) =>
        sendResponse({ status: "error", message: error.message })
      );
    return true;
  }

  if (message?.type === "GET_STATE") {
    sendResponse({
      status: "ok",
      state: {
        running: state.running,
        topic: state.topic,
        plannedRounds: state.plannedRounds,
        logs: state.logs,
        roundLogs: state.roundLogs,
        summary: state.summary,
        agents: state.agentTabs.map(({ name, tabId }) => ({ name, tabId })),
      },
    });
    return false;
  }

  if (message?.type === "STOP_DISCUSSION") {
    const wasRunning = state.running;
    state.running = false;
    if (wasRunning) {
      pushLog("ユーザー操作により議論を停止しました。");
      notifyState();
    }
    sendResponse({ status: "ok", wasRunning });
    return false;
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const index = state.agentTabs.findIndex((tab) => tab.tabId === tabId);
  if (index >= 0) {
    state.agentTabs.splice(index, 1);
    pushLog(`タブ ${tabId} が閉じられました。再初期化が必要です。`);
    notify({ type: "AGENT_TAB_CLOSED", tabId });
  }
});

async function startDiscussion(topic, rounds) {
  if (!topic) {
    throw new Error("議題を入力してください。");
  }
  if (state.running) {
    throw new Error("別の議論が進行中です。完了を待ってから再実行してください。");
  }

  state.agentConfigs = await loadAgents();
  state.running = true;
  state.topic = topic;
  state.plannedRounds = rounds;
  state.roundLogs = [];
  state.summary = "";
  state.logs = [];
  notifyState();

  try {
    pushLog("エージェント用タブを準備しています…");
    await prepareAgentTabs();

    pushLog("各エージェントの役割を初期化しています…");
    await initializeAgents();

    pushLog(`議論を開始します（ラウンド数: ${rounds}）。`);
    await executeRounds(rounds, topic);

    if (!state.running) {
      pushLog("議論は途中で停止されました。最終まとめはスキップされます。");
      return { summary: state.summary, rounds: state.roundLogs };
    }

    pushLog("JUDGEによる最終まとめを依頼しています…");
    const summary = await requestFinalSummary(topic);
    state.summary = summary;

    notify({
      type: "DISCUSSION_COMPLETE",
      summary,
      rounds: state.roundLogs,
    });
    pushLog("議論が完了しました。");

    return { summary, rounds: state.roundLogs };
  } catch (error) {
    pushLog(`エラー: ${error.message}`);
    notify({ type: "DISCUSSION_ERROR", message: error.message });
    throw error;
  } finally {
    state.running = false;
    notifyState();
  }
}

async function loadAgents() {
  return DEFAULT_AGENTS;
}

async function prepareAgentTabs() {
  await Promise.all(state.agentTabs.map((agent) => safeRemoveTab(agent.tabId)));
  state.agentTabs = [];

  for (const [index, agent] of state.agentConfigs.entries()) {
    const tab = await createTab({ url: CHATGPT_URL, active: index === 0 });
    await disableAutoDiscard(tab.id);
    await waitForTabComplete(tab.id);
    await ensureContentReady(tab.id);
    state.agentTabs.push({ ...agent, tabId: tab.id });
    if (index === 0) {
      await prepareChromeCall(chrome.tabs.update, tab.id, { active: false });
    }
    pushLog(`[${agent.name}] タブ準備完了 (tabId: ${tab.id})`);
  }
}

async function initializeAgents() {
  for (const [index, agent] of state.agentTabs.entries()) {
    await ensureTabVisible(agent.tabId, index === 0);

    const prompt = buildInitializationPrompt(agent);
    const response = await sendPromptToAgent(agent, prompt);
    const text = response.text || "";
    if (text.includes(`${agent.name}、準備完了`)) {
      pushLog(`[${agent.name}] 初期化完了`);
    } else {
      pushLog(`[${agent.name}] 初期化確認: 想定外の応答 -> ${truncate(text)}`);
    }

    if (state.running) {
      await prepareChromeCall(chrome.tabs.update, agent.tabId, { active: false });
    }
  }
}

async function executeRounds(rounds, topic) {
  const roundLogs = [];
  let previousContext = null;

  for (let round = 1; round <= rounds; round += 1) {
    if (!state.running) {
      pushLog(`ラウンド ${round} 開始前に停止されました。`);
      break;
    }

    pushLog(`ラウンド ${round}/${rounds} を実行しています…`);

    const previousDigest = buildPreviousDigest(previousContext);
    const coreAgents = getAgentsByNames(CORE_AGENT_NAMES);
    const coreResponses = await broadcastRoundToAgents({
      agents: coreAgents,
      topic,
      round,
      previousDigest,
    });

    const analyst = getAgentByName(ANALYST_NAME);
    let analystResponse = null;
    if (analyst) {
      const analystPrompt = buildAnalystPrompt({
        topic,
        round,
        responses: coreResponses,
      });
      const res = await sendPromptToAgent(analyst, analystPrompt);
      analystResponse = res.text;
      pushLog(`[${ANALYST_NAME}] 応答取得`);
    }

    const responses = {
      ...coreResponses,
      ...(analystResponse ? { [ANALYST_NAME]: analystResponse } : {}),
    };

    roundLogs.push(responses);
    state.roundLogs = roundLogs;
    previousContext = { coreResponses, analystSummary: analystResponse };

    notify({ type: "ROUND_COMPLETE", round, responses });
  }
}

async function requestFinalSummary(topic) {
  if (!state.roundLogs.length) {
    throw new Error("議論ログが存在しないため、まとめを生成できません。");
  }

  const judge = getAgentByName(JUDGE_NAME);
  if (!judge) {
    throw new Error("JUDGEタブが見つかりませんでした。");
  }
  const prompt = buildJudgePrompt(topic, state.roundLogs);
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

function buildAgentPrompt({ agent, topic, round, previousDigest }) {
  const recap = previousDigest
    ? `【前ラウンドの要約】\n${previousDigest}\n\n`
    : "";
  const roundLabel = round === 1 ? "【議題】" : "【議題（再掲）】";
  const instruction = agent.roundInstruction
    ? `【あなたへの追加指示】\n${agent.roundInstruction}\n\n`
    : "";

  return `あなたは ${agent.name} です。
視点: ${agent.role}
${agent.systemPrompt}

${roundLabel}
${topic}

${recap}${instruction}上記を踏まえて、あなたの視点から意見を述べてください。日本語で500〜800文字程度、段落または箇条書きを交えてください。`;
}

function buildAnalystPrompt({ topic, round, responses }) {
  const digest = formatResponses(responses);
  return `あなたは ANALYST です。以下はラウンド${round}で各エージェントが述べた内容です。

【議題】
${topic}

【参考発言】
${digest}

以下の形式で日本語でまとめてください：
1. 合意された点（箇条書き）
2. 意見が分かれた点（箇条書き）
3. 次ラウンドで深掘りすべき論点（箇条書き）
4. 追加で気づいた示唆（任意）

すべて箇条書きを中心に、200〜350文字程度でコンパクトにまとめてください。`;
}

function buildJudgePrompt(topic, rounds) {
  const digest = rounds
    .map((round, index) => `### ラウンド${index + 1}\n${formatResponses(round)}`)
    .join("\n\n");

  return `あなたはJUDGEです。以下の議論ログを踏まえて、最終結論をMarkdown形式で作成してください。

## 議題
${topic}

## 出力フォーマット
### 主要な論点
- 箇条書き

### 合意された点
- 箇条書き

### 意見が分かれた点
- 箇条書き

### 推奨する結論・次のアクション
- 箇条書きや段落で、実務的な提案

## 議論ログ
${digest}

上記フォーマットを厳守してください。`;
}

function formatResponses(responses) {
  return Object.entries(responses)
    .map(([name, text]) => {
      const trimmed = (text || "").trim();
      return `【${name}】\n${trimmed.slice(0, 800)}${
        trimmed.length > 800 ? "..." : ""
      }`;
    })
    .join("\n\n");
}

async function broadcastRoundToAgents({ agents, topic, round, previousDigest }) {
  const results = {};

  await Promise.all(
    agents.map(async (agent) => {
      const prompt = buildAgentPrompt({ agent, topic, round, previousDigest });
      const response = await sendPromptToAgent(agent, prompt);
      results[agent.name] = response.text;
      pushLog(`[${agent.name}] 応答取得`);
    })
  );

  return results;
}

async function sendPromptToAgent(agent, prompt, maxRetry = 2) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetry; attempt += 1) {
    try {
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
      pushLog(
        `[${agent.name}] 応答取得失敗 (${attempt + 1}/${maxRetry + 1}): ${error.message}`
      );
      if (attempt < maxRetry) {
        await delay(1000 * (attempt + 1));
      }
    }
  }
  throw new Error(`[${agent.name}] 応答取得に失敗しました: ${lastError?.message}`);
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
  if (tab?.status === "complete") {
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
    fn(...args, (result) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(result);
    });
  });
}

function createTab(options) {
  return prepareChromeCall(chrome.tabs.create, options);
}

function disableAutoDiscard(tabId) {
  return prepareChromeCall(chrome.tabs.update, tabId, {
    autoDiscardable: false,
    muted: true,
  }).catch((error) => {
    pushLog(`タブ${tabId}の自動スリープ設定に失敗: ${error.message}`);
  });
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
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response);
    });
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
}

function notifyState() {
  notify({
    type: "STATE_UPDATE",
    state: {
      running: state.running,
      topic: state.topic,
      plannedRounds: state.plannedRounds,
      logs: state.logs,
      roundLogs: state.roundLogs,
      summary: state.summary,
      agents: state.agentTabs.map(({ name, tabId }) => ({ name, tabId })),
    },
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
  return (
    error?.message?.includes("Receiving end does not exist") ||
    error?.message?.includes("No tab with id")
  );
}

async function ensureTabVisible(tabId) {
  try {
    await prepareChromeCall(chrome.tabs.update, tabId, { active: true });
    await delay(INITIALIZATION_ACTIVE_DURATION_MS);
  } catch (error) {
    pushLog(`タブ${tabId}の表示切替に失敗: ${error.message}`);
  }
}

function buildPreviousDigest(previousContext) {
  if (!previousContext) {
    return "";
  }

  const summaryPart = previousContext.analystSummary
    ? `ANALYST要約:\n${previousContext.analystSummary}`
    : "";
  const rawPart = previousContext.coreResponses
    ? formatResponses(previousContext.coreResponses)
    : "";

  return [summaryPart, rawPart].filter(Boolean).join("\n\n").slice(0, 2_000);
}

function getAgentsByNames(nameSet) {
  return state.agentTabs.filter((agent) => nameSet.has(agent.name));
}

function getAgentByName(name) {
  return state.agentTabs.find((agent) => agent.name === name);
}

