"use strict";

const CHATGPT_URL = "https://chatgpt.com/";
const RESPONSE_TIMEOUT_MS = 600_000;
const TAB_LOAD_TIMEOUT_MS = 60_000;
const CONTENT_READY_TIMEOUT_MS = 60_000;
const MAX_LOG_ENTRIES = 500;

const AGENTS = [
  {
    name: "MELCHIOR",
    role: "楽観的・可能性重視の視点",
    systemPrompt:
      "あなたはMELCHIORです。物事の良い面、可能性、チャンスに焦点を当てて議論してください。建設的で前向きな視点を提供します。",
  },
  {
    name: "BALTHASAR",
    role: "慎重・リスク重視の視点",
    systemPrompt:
      "あなたはBALTHASARです。リスク、問題点、懸念事項に焦点を当てて議論してください。批判的思考で潜在的な問題を指摘します。",
  },
  {
    name: "CASPER",
    role: "中立・技術的視点",
    systemPrompt:
      "あなたはCASPERです。感情を排し、データと論理に基づいて客観的に分析してください。技術的・実務的な観点を重視します。",
  },
  {
    name: "ANALYST",
    role: "統合・分析担当",
    systemPrompt:
      "あなたはANALYSTです。他の議論参加者の意見を統合し、共通点と相違点を整理してください。議論の構造化を担当します。",
  },
  {
    name: "JUDGE",
    role: "最終判断・結論担当",
    systemPrompt:
      "あなたはJUDGEです。全ての議論を踏まえて、バランスの取れた最終的な結論や提案を導き出してください。",
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

  for (const agent of AGENTS) {
    if (!state.running) return;
    const tab = await createTab({ url: CHATGPT_URL, active: false });
    await waitForTabComplete(tab.id);
    await ensureContentReady(tab.id);
    state.agentTabs.push({ ...agent, tabId: tab.id });
    pushLog(`【${agent.name}】 タブ準備完了 (tabId: ${tab.id})`);
  }
}

async function initializeAgents() {
  await Promise.all(
    state.agentTabs.map(async (agent) => {
      if (!state.running) return;
      try {
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
    })
  );
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

あなたの視点（{agent_role}）から、この議題について意見を述べてください。`;
}

function buildFollowupPrompt(previousResponses) {
  const digest = formatResponses(previousResponses);
  return `【前ラウンドの議論】
${digest}

上記の議論を踏まえて、あなたの視点からさらに深掘りした意見、反論、または新たな観点を述べてください。`;
}

function buildSummaryPrompt(topic, rounds) {
  const digest = rounds
    .map((round, index) => `ラウンド${index + 1}:
${formatResponses(round)}`)
    .join("\n\n");

  return `【議論の総括依頼】

議題: ${topic}

全${rounds.length}ラウンドの議論が終了しました。
JUDGEとして、以下の観点から最終的なまとめを作成してください：

1. 各視点からの主要な論点
2. 合意が得られた点
3. 意見が分かれた点
4. 最終的な結論・提案

【参考】
${digest}

簡潔かつ構造的にまとめてください。`;
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
