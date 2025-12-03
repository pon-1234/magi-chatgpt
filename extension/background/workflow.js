"use strict";

import { MSG, EVENT } from "../messages.js";
import {
  state,
  getAgentDefinitions,
  getModeDefinition,
  getModeLabel,
  resolveModeKey,
  ensureStateReady,
  pushLog,
  notify,
  notifyState,
  scheduleStatePersist,
  getSettings,
} from "./state.js";
import {
  buildInitializationPrompt,
  buildAnalystPrompt,
  buildCriticBootstrapPrompt,
  buildConvergencePrompt,
  parseConvergenceDecision,
  renderTemplate,
} from "./prompt-templates.js";
import {
  prepareChromeCall,
  createTab,
  safeRemoveTab,
  getTab,
  sendMessageToTab,
  delay,
  isNoReceivingEndError,
  isTransientError,
} from "./chrome-helpers.js";

const CHATGPT_URL = "https://chatgpt.com/";
const TAB_LOAD_TIMEOUT_MS = 60_000;
const CONTENT_READY_TIMEOUT_MS = 60_000;
const TAB_ACTIVATION_DURATION_MS = 2_000;
const CRITIQUE_RETRY_LIMIT = 1;

let keepAliveIntervalId = null;
let activeWorkflowPromise = null;

export async function startDiscussion(topic, rounds, modeKey = state.mode) {
  await ensureStateReady();
  await disposeAgentTabs();
  state.running = true;
  const normalizedMode = resolveModeKey(modeKey) ?? state.mode;
  state.mode = normalizedMode;
  state.activeMode = normalizedMode;
  state.stopRequested = false;
  state.topic = topic;
  state.plannedRounds = rounds;
  state.roundLogs = [];
  state.summary = "";
  state.logs = [];
  state.agentTabs = [];
  state.initialCritique = "";
  scheduleStatePersist();
  const modeLabel = getModeLabel(normalizedMode);
  pushLog(`議論を開始します: 「${topic}」 (モード: ${modeLabel} / ラウンド数: ${rounds})`);
  notifyState();
  await runDiscussionWorkflow({ resume: false });
}

export async function runDiscussionWorkflow({ resume = false } = {}) {
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

      try {
        await runInitialCritique(state.topic);
      } catch (error) {
        pushLog(`ラウンド0実行中にエラー: ${error.message}`);
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
        type: EVENT.DISCUSSION_COMPLETE,
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

export function resumeDiscussionWorkflow() {
  if (!state.running) return;
  if (activeWorkflowPromise) return;

  runDiscussionWorkflow({ resume: true }).catch((error) => {
    pushLog(`復元中にエラーが発生しました: ${error.message}`);
    notify({ type: EVENT.DISCUSSION_ERROR, message: error.message });
  });
}

export async function abortAllAgentPrompts(reason = "ユーザーによって中断されました。") {
  if (!state.agentTabs.length) return;
  const tasks = state.agentTabs.map((agent) =>
    sendMessageToTab(agent.tabId, { type: MSG.ABORT_PROMPT, reason }).catch((error) => {
      if (!isNoReceivingEndError(error)) {
        pushLog(`【${agent.name}】 中断リクエスト送信に失敗しました: ${error.message}`);
      }
    })
  );
  await Promise.all(tasks);
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
  try {
    if (state.agentWindowId) {
      await prepareChromeCall(chrome.windows.get, state.agentWindowId, { populate: false });
      return state.agentWindowId;
    }

    const window = await prepareChromeCall(chrome.windows.create, {
      url: "chrome://newtab/",
      focused: false,
      type: "normal",
      state: "minimized",
    });
    state.agentWindowId = window?.id ?? null;
    notifyState();
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
  const normalized = state.roundLogs;
  const criticRounds = normalized.filter((entry) => (entry?.round ?? 0) <= 0);
  const mainRounds = normalized.filter((entry) => (entry?.round ?? 0) >= 1);

  if (mainRounds.length >= rounds) {
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
    mainRounds.length > 0 ? mainRounds[mainRounds.length - 1]?.analyst ?? "" : "";
  const modeDefinition = getModeDefinition();

  for (let round = mainRounds.length + 1; round <= rounds; round += 1) {
    if (!state.running) break;

    pushLog(`ラウンド ${round}/${rounds} を実行しています…`);

    const template =
      round === 1 && !previousAnalystSummary
        ? modeDefinition.buildFirstRoundPrompt(topic, state.initialCritique)
        : modeDefinition.buildFollowupPrompt(previousAnalystSummary, {
            topic,
            round,
            plannedRounds: rounds,
            critique: state.initialCritique,
            recentRounds: state.roundLogs.slice(-3),
          });

    const includeTheorist = Boolean(theoristAgent && round === 1 && mainRounds.length === 0);
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
    mainRounds.push(roundEntry);
    state.roundLogs = [...criticRounds, ...mainRounds];

    notify({
      type: EVENT.ROUND_COMPLETE,
      round,
      responses: participantResponses,
      analyst: analystSummary,
    });
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

async function runInitialCritique(topic) {
  if (!state.running) {
    return;
  }
  if ((state.initialCritique || "").trim()) {
    pushLog("ラウンド0の否定レビューは既に存在するためスキップします。");
    return;
  }

  const criticAgent = state.agentTabs.find((agent) => agent.name === "BALTHASAR");
  if (!criticAgent) {
    pushLog("BALTHASARタブが見つからないため、ラウンド0否定レビューをスキップします。");
    return;
  }

  pushLog("ラウンド0: BALTHASARによる否定的レビューを実行します…");
  const prompt = buildCriticBootstrapPrompt(topic);

  try {
    const res = await sendPromptToAgent(criticAgent, prompt, CRITIQUE_RETRY_LIMIT);
    const text = (res?.text || "").trim() || "(内容なし)";
    state.initialCritique = text;

    const existingMainRounds = (state.roundLogs || []).filter((entry) => (entry?.round ?? 0) >= 1);
    const round0 = {
      round: 0,
      participants: { [criticAgent.name]: text },
      analyst: "",
    };
    state.roundLogs = [round0, ...existingMainRounds];

    notify({
      type: EVENT.ROUND_COMPLETE,
      round: 0,
      responses: round0.participants,
      analyst: "",
    });
    notifyState();
    pushLog("ラウンド0の否定レビューを取得しました。");
  } catch (error) {
    pushLog(`ラウンド0否定レビュー取得に失敗しました: ${error.message}`);
  }
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
        const settings = getSettings();
        const response = await sendMessageToTab(agent.tabId, {
          type: MSG.SEND_PROMPT,
          prompt,
          agentName: agent.name,
          timeout: settings.responseTimeoutMs,
        });

        if (response?.status !== "ok") {
          throw new Error(response?.message ?? response?.error ?? "不明なエラー");
        }

        detectPromptEchoMismatch(agent, prompt, response?.data?.lastUserText);
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

function detectPromptEchoMismatch(agent, prompt, lastUserText) {
  const sent = (prompt || "").trim();
  const echoed = (lastUserText || "").trim();
  if (!sent || !echoed || sent === echoed) {
    return;
  }
  pushLog(
    `【${agent.name}】 送信したプロンプトと実際の入力内容が一致しません（実際: ${truncate(
      echoed,
      60
    )}）。`
  );
}

async function ensureContentReady(tabId) {
  const start = Date.now();
  while (Date.now() - start < CONTENT_READY_TIMEOUT_MS) {
    try {
      const ping = await sendMessageToTab(tabId, { type: MSG.PING });
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

    function cleanup() {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timeoutId);
    }

    function listener(updatedTabId, info) {
      if (updatedTabId !== tabId) return;
      if (info.status === "complete") {
        cleanup();
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

function startPeriodicActivation(agent, reason) {
  const interval = getSettings().tabRefocusIntervalMs;
  if (!interval || interval <= 0) {
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
        timerId = setTimeout(tick, interval);
      }
    }
  };

  timerId = setTimeout(tick, interval);

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

    if (previousContext?.tabId && previousContext.tabId !== tabId) {
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

function truncate(text, max = 120) {
  if (!text) return "";
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}


