"use strict";

import { MSG, EVENT } from "./messages.js";

const form = document.getElementById("control-form");
const topicInput = document.getElementById("topic-input");
const roundsInput = document.getElementById("rounds-input");
const modeSelect = document.getElementById("mode-select");
const statusBadge = document.getElementById("status");
const logView = document.getElementById("log-view");
const summaryView = document.getElementById("summary-view");
const roundsView = document.getElementById("rounds-view");
const clearLogButton = document.getElementById("clear-log-btn");
const downloadLogButton = document.getElementById("download-log-btn");
const startButton = document.getElementById("start-btn");
const stopButton = document.getElementById("stop-btn");
const responseTimeoutInput = document.getElementById("response-timeout-input");
const tabRefocusInput = document.getElementById("tab-refocus-input");
const saveSettingsButton = document.getElementById("settings-save-btn");
const settingsStatus = document.getElementById("settings-status");
const AGENT_DISPLAY_ORDER = ["MELCHIOR", "BALTHASAR", "CASPER", "THEORIST", "ANALYST", "JUDGE"];
const MODE_LABELS = {
  general: "汎用モード",
  development: "システム開発モード",
};

let latestState = null;
let latestSettings = null;
let settingsSaving = false;
const SETTINGS_LIMITS = {
  responseTimeoutSeconds: { min: 60, max: 900 },
  tabRefocusSeconds: { min: 10, max: 300 },
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const topic = topicInput.value.trim();
  const rounds = Number(roundsInput.value) || 3;
  const mode = modeSelect.value || "general";
  const modeLabel = MODE_LABELS[mode] || mode;

  if (!topic) {
    appendLog("⚠️ 議題を入力してください。");
    return;
  }

  setFormDisabled(true);
  appendLog(`議論を開始します: 「${topic}」 (モード: ${modeLabel} / ラウンド: ${rounds})`);

  try {
    await sendRuntimeMessage({
      type: MSG.START_DISCUSSION,
      topic,
      rounds,
      mode,
    });
  } catch (error) {
    appendLog(`エラー: ${error.message}`);
    setFormDisabled(false);
  }
});

modeSelect.addEventListener("change", async () => {
  const mode = modeSelect.value || "general";
  const label = MODE_LABELS[mode] || mode;
  try {
    await sendRuntimeMessage({ type: MSG.SET_MODE, mode });
    appendLog(`⚙️ モードを ${label} に切り替えました。`);
  } catch (error) {
    appendLog(`⚠️ モード切替に失敗しました: ${error.message}`);
    await refreshState().catch(() => {});
  }
});

clearLogButton.addEventListener("click", async () => {
  if (clearLogButton.disabled) return;
  clearLogButton.disabled = true;
  try {
    await sendRuntimeMessage({ type: MSG.CLEAR_LOGS });
    logView.textContent = "ログをクリアしました。";
  } catch (error) {
    appendLog(`⚠️ ログのクリアに失敗しました: ${error.message}`);
  } finally {
    clearLogButton.disabled = false;
  }
});

downloadLogButton.addEventListener("click", () => {
  if (!latestState || (!latestState.roundLogs?.length && !latestState.summary)) {
    appendLog("📄 ダウンロードできる議論結果がまだありません。");
    return;
  }

  const markdown = buildDiscussionMarkdown(latestState);
  if (!markdown.trim()) {
    appendLog("⚠️ ログ生成に失敗しました。");
    return;
  }

  const filename = buildLogFilename(latestState.topic);
  triggerMarkdownDownload(markdown, filename);
  appendLog(`📥 ログを保存しました (${filename})`);
});

stopButton.addEventListener("click", async () => {
  if (stopButton.disabled) return;
  stopButton.disabled = true;
  appendLog("⏹ 議論停止をリクエストしました。");
  try {
    await sendRuntimeMessage({ type: MSG.STOP_DISCUSSION });
  } catch (error) {
    appendLog(`停止要求に失敗しました: ${error.message}`);
    stopButton.disabled = false;
  }
});

if (saveSettingsButton) {
  saveSettingsButton.addEventListener("click", async () => {
    try {
      const payload = collectSettingsPayload();
      setSettingsStatus("保存中…", "pending");
      const response = await sendRuntimeMessage({ type: MSG.UPDATE_SETTINGS, settings: payload });
      latestSettings = response?.settings ?? payload;
      applySettingsToForm(latestSettings, { force: true });
      setSettingsStatus("保存済み", "success");
      appendLog("⚙️ タイムアウト設定を更新しました。");
    } catch (error) {
      setSettingsStatus("保存失敗", "error");
      appendLog(`⚠️ 設定更新に失敗しました: ${error.message}`);
    }
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === EVENT.LOG) {
    appendLog(formatLogEntry(message.entry));
  }

  if (message?.type === EVENT.STATE_UPDATE) {
    renderState(message.state);
  }

  if (message?.type === EVENT.ROUND_COMPLETE) {
    appendLog(`ラウンド${message.round}の応答を取得しました。`);
  }

  if (message?.type === EVENT.DISCUSSION_COMPLETE) {
    appendLog("✅ 議論が完了しました。");
    renderSummary(message.summary);
    setFormDisabled(false);
  }

  if (message?.type === EVENT.DISCUSSION_ERROR) {
    appendLog(`⚠️ エラー: ${message.message}`);
    setFormDisabled(false);
  }

  if (message?.type === EVENT.SETTINGS_UPDATED) {
    latestSettings = message.settings || latestSettings;
    applySettingsToForm(latestSettings);
    setSettingsStatus("最新", "success");
  }
});

Promise.all([refreshState(), requestInitialSettings()]).catch((error) => {
  appendLog(`初期データ取得に失敗しました: ${error.message}`);
});

function appendLog(text) {
  if (!text) return;
  const current = logView.textContent?.trim();
  const normalized = text.toString();
  const alreadyStamped = /^\d{2}:\d{2}:\d{2}/.test(normalized.trim());
  const line = alreadyStamped ? normalized : `${timestamp()} ${normalized}`;
  logView.textContent = current ? `${current}\n${line}` : line;
  logView.scrollTop = logView.scrollHeight;
}

function renderSummary(summary) {
  summaryView.textContent = summary || "まだまとめはありません。";
}

function renderRounds(roundLogs) {
  roundsView.innerHTML = "";
  if (!roundLogs?.length) {
    roundsView.textContent = "ラウンド結果はまだありません。";
    return;
  }

  const fragment = document.createDocumentFragment();
  roundLogs.forEach((round, index) => {
    const details = document.createElement("details");
    if (index === roundLogs.length - 1) {
      details.open = true;
    }

    const summary = document.createElement("summary");
    const label = round?.round ?? index + 1;
    summary.textContent = `ラウンド${label}`;
    details.appendChild(summary);

    const participants = round?.participants || {};
    const participantKeys = Object.keys(participants);
    if (participantKeys.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "応答が取得できませんでした。";
      details.appendChild(empty);
    } else {
      const displayOrder = Array.from(new Set([...AGENT_DISPLAY_ORDER, ...participantKeys]));
      displayOrder.forEach((name) => {
        const text = participants[name];
        if (!text) return;
        const heading = document.createElement("h4");
        heading.textContent = name;
        details.appendChild(heading);
        details.appendChild(createRoundPre(text));
      });
    }

    if (round?.analyst) {
      const heading = document.createElement("h4");
      heading.textContent = "ANALYST";
      details.appendChild(heading);
      details.appendChild(createRoundPre(round.analyst));
    }

    fragment.appendChild(details);
  });

  roundsView.appendChild(fragment);
}

function renderState(state) {
  if (!state) return;
  latestState = JSON.parse(JSON.stringify(state));

  if (typeof state.topic === "string" && !topicInput.value) {
    topicInput.value = state.topic;
  }
  if (
    typeof state.plannedRounds === "number" &&
    (!roundsInput.value || Number(roundsInput.value) === 0)
  ) {
    roundsInput.value = String(state.plannedRounds);
  }

  if (modeSelect) {
    const preferredMode = state.mode && MODE_LABELS[state.mode] ? state.mode : "general";
    modeSelect.value = preferredMode;
  }
  const statusText = state.running
    ? state.stopRequested
      ? "停止要求中"
      : "実行中"
    : "待機中";
  const badgeModeLabel =
    state.modeLabel ||
    MODE_LABELS[state.activeMode] ||
    MODE_LABELS[state.mode] ||
    "";
  statusBadge.textContent = badgeModeLabel ? `${statusText}・${badgeModeLabel}` : statusText;
  statusBadge.classList.toggle("running", Boolean(state.running));
  setFormDisabled(Boolean(state.running), Boolean(state.stopRequested));

  if (state.logs?.length) {
    logView.textContent = state.logs.map((entry) => formatLogEntry(entry)).join("\n");
    logView.scrollTop = logView.scrollHeight;
  } else {
    logView.textContent = "ログはまだありません。";
  }

  renderSummary(state.summary || "");
  renderRounds(state.roundLogs || []);
  if (state.settings) {
    applySettingsToForm(state.settings);
  }
}

function setFormDisabled(isRunning, stopRequested = false) {
  topicInput.disabled = isRunning;
  roundsInput.disabled = isRunning;
  startButton.disabled = isRunning;
  stopButton.disabled = !isRunning || stopRequested;
}

function formatLogEntry(entry) {
  if (!entry) return "";
  const time = entry.timestamp
    ? new Date(entry.timestamp).toLocaleTimeString("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "--:--:--";
  return `${time} ${entry.message}`;
}

function createRoundPre(text) {
  const pre = document.createElement("pre");
  pre.textContent = text || "(内容なし)";
  return pre;
}

function buildDiscussionMarkdown(state) {
  const lines = [];
  const topic = state.topic?.trim() || "未設定";
  const modeKey = state.activeMode || state.mode || "general";
  const modeLabel = MODE_LABELS[modeKey] || modeKey;
  lines.push(`# 議題: ${topic}`);
  lines.push(`- モード: ${modeLabel}`);
  lines.push("");

  const rounds = Array.isArray(state.roundLogs) ? state.roundLogs : [];
  rounds.forEach((round, index) => {
    const label = round?.round ?? index + 1;
    lines.push(`## ラウンド${label}`);
    lines.push("");
    const responses = round?.participants || {};
    const agentOrder = Array.from(new Set([...AGENT_DISPLAY_ORDER, ...Object.keys(responses)]));
    agentOrder.forEach((name) => {
      if (!responses[name]) return;
      lines.push(`### ${name}`);
      lines.push(responses[name].trim());
      lines.push("");
    });
    if (round?.analyst) {
      lines.push("### ANALYST");
      lines.push(round.analyst.trim());
      lines.push("");
    }
  });

  lines.push("## 最終結論 (JUDGE)");
  lines.push(state.summary?.trim() || "未生成です。");
  lines.push("");

  if (state.logs?.length) {
    lines.push("## システムログ");
    state.logs.forEach((entry) => {
      lines.push(`- ${formatLogEntry(entry)}`);
    });
    lines.push("");
  }

  return lines.join("\n");
}

function buildLogFilename(topic) {
  const stem = sanitizeFileStem(topic);
  const iso = new Date().toISOString().replace(/[:.]/g, "-");
  return `magi-${stem}-${iso}.md`;
}

function triggerMarkdownDownload(content, filename) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sanitizeFileStem(input) {
  if (!input) return "discussion";
  const trimmed = input.toString().trim();
  if (!trimmed) return "discussion";
  const sanitized = trimmed
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/[\u0000-\u001F]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .replace(/^-|-$/g, "");
  return sanitized || "discussion";
}

function applySettingsToForm(settings, { force = false } = {}) {
  if (!settings) return;
  latestSettings = { ...settings };
  if (responseTimeoutInput && (force || document.activeElement !== responseTimeoutInput)) {
    responseTimeoutInput.value = msToSeconds(settings.responseTimeoutMs);
  }
  if (tabRefocusInput && (force || document.activeElement !== tabRefocusInput)) {
    tabRefocusInput.value = msToSeconds(settings.tabRefocusIntervalMs);
  }
}

function collectSettingsPayload() {
  if (!responseTimeoutInput || !tabRefocusInput) {
    throw new Error("設定入力欄が見つかりません。");
  }
  const responseSeconds = clamp(
    Number(responseTimeoutInput.value),
    SETTINGS_LIMITS.responseTimeoutSeconds.min,
    SETTINGS_LIMITS.responseTimeoutSeconds.max
  );
  const refocusSeconds = clamp(
    Number(tabRefocusInput.value),
    SETTINGS_LIMITS.tabRefocusSeconds.min,
    SETTINGS_LIMITS.tabRefocusSeconds.max
  );
  if (!Number.isFinite(responseSeconds)) {
    throw new Error("応答待ちタイムアウトが無効です。");
  }
  if (!Number.isFinite(refocusSeconds)) {
    throw new Error("タブ再アクティブ化間隔が無効です。");
  }
  return {
    responseTimeoutMs: secondsToMs(responseSeconds),
    tabRefocusIntervalMs: secondsToMs(refocusSeconds),
  };
}

function msToSeconds(ms) {
  if (!Number.isFinite(Number(ms))) return "";
  return Math.round(Number(ms) / 1000);
}

function secondsToMs(seconds) {
  return Math.round(Number(seconds) * 1000);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function setSettingsStatus(text, variant = "idle") {
  if (!settingsStatus) return;
  settingsStatus.textContent = text;
  settingsStatus.dataset.status = variant;
}

async function requestInitialSettings() {
  setSettingsStatus("取得中…", "pending");
  try {
    const response = await sendRuntimeMessage({ type: MSG.GET_SETTINGS });
    if (response?.settings) {
      latestSettings = response.settings;
      applySettingsToForm(response.settings, { force: true });
      setSettingsStatus("同期済み", "success");
      return;
    }
  } catch (error) {
    appendLog(`⚠️ 設定取得に失敗しました: ${error.message}`);
    setSettingsStatus("エラー", "error");
    return;
  }
  setSettingsStatus("未同期", "idle");
}

async function refreshState() {
  const response = await sendRuntimeMessage({ type: MSG.GET_STATE });
  if (response?.state) {
    renderState(response.state);
  }
}

function sendRuntimeMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      if (response?.status === "error") {
        reject(new Error(response.message));
        return;
      }
      resolve(response);
    });
  });
}

function timestamp() {
  return new Date().toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// URLパラメータで自動実行（DOMの準備状況に依らず実行）
function autoSubmitFromUrlParams() {
  try {
    const params = new URLSearchParams(window.location.search);
    const topicParam = params.get("topic");
    const roundsParam = params.get("rounds");

    if (!topicParam?.trim()) {
      return; // 通常の手動入力モード
    }

    const topicValue = topicParam.trim();

    // フォームに値を入れる
    topicInput.value = topicValue;
    if (roundsParam) {
      const n = Number(roundsParam);
      if (Number.isFinite(n) && n > 0 && n <= 10) {
        roundsInput.value = String(n);
      }
    }

    // ログに一言
    appendLog(`🛰 リモートコマンドを受信: 「${topicValue}」`);

    // 自動でフォーム送信 → START_DISCUSSION メッセージが飛ぶ
    form.requestSubmit();
  } catch (error) {
    console.error("URLパラメータ処理エラー:", error);
    appendLog("⚠️ URLパラメータ処理に失敗しました。");
  }
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", autoSubmitFromUrlParams);
} else {
  autoSubmitFromUrlParams();
}

