const form = document.getElementById("control-form");
const topicInput = document.getElementById("topic-input");
const roundsInput = document.getElementById("rounds-input");
const statusBadge = document.getElementById("status");
const logView = document.getElementById("log-view");
const summaryView = document.getElementById("summary-view");
const roundsView = document.getElementById("rounds-view");
const clearLogButton = document.getElementById("clear-log-btn");
const downloadLogButton = document.getElementById("download-log-btn");
const startButton = document.getElementById("start-btn");
const stopButton = document.getElementById("stop-btn");
const AGENT_DISPLAY_ORDER = ["MELCHIOR", "BALTHASAR", "CASPER", "THEORIST", "ANALYST", "JUDGE"];

let latestState = null;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const topic = topicInput.value.trim();
  const rounds = Number(roundsInput.value) || 3;

  if (!topic) {
    appendLog("⚠️ 議題を入力してください。");
    return;
  }

  setFormDisabled(true);
  appendLog(`議論を開始します: 「${topic}」 (ラウンド: ${rounds})`);

  try {
    await sendRuntimeMessage({
      type: "START_DISCUSSION",
      topic,
      rounds,
    });
  } catch (error) {
    appendLog(`エラー: ${error.message}`);
    setFormDisabled(false);
  }
});

clearLogButton.addEventListener("click", () => {
  logView.textContent = "ログをクリアしました。";
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
    await sendRuntimeMessage({ type: "STOP_DISCUSSION" });
  } catch (error) {
    appendLog(`停止要求に失敗しました: ${error.message}`);
    stopButton.disabled = false;
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "LOG") {
    appendLog(formatLogEntry(message.entry));
  }

  if (message?.type === "STATE_UPDATE") {
    renderState(message.state);
  }

  if (message?.type === "ROUND_COMPLETE") {
    appendLog(`ラウンド${message.round}の応答を取得しました。`);
  }

  if (message?.type === "DISCUSSION_COMPLETE") {
    appendLog("✅ 議論が完了しました。");
    renderSummary(message.summary);
    setFormDisabled(false);
  }

  if (message?.type === "DISCUSSION_ERROR") {
    appendLog(`⚠️ エラー: ${message.message}`);
    setFormDisabled(false);
  }
});

refreshState().catch((error) => {
  appendLog(`状態取得に失敗しました: ${error.message}`);
});

function appendLog(text) {
  const current = logView.textContent?.trim();
  logView.textContent = current
    ? `${current}\n${timestamp()} ${text}`
    : `${timestamp()} ${text}`;
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
    if (Object.keys(participants).length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "応答が取得できませんでした。";
      details.appendChild(empty);
    } else {
      Object.entries(participants).forEach(([name, text]) => {
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

  statusBadge.textContent = state.running ? "実行中" : "待機中";
  statusBadge.classList.toggle("running", Boolean(state.running));
  setFormDisabled(Boolean(state.running));

  if (state.logs?.length) {
    logView.textContent = state.logs.map((entry) => formatLogEntry(entry)).join("\n");
    logView.scrollTop = logView.scrollHeight;
  } else {
    logView.textContent = "ログはまだありません。";
  }

  renderSummary(state.summary || "");
  renderRounds(state.roundLogs || []);
}

function setFormDisabled(disabled) {
  topicInput.disabled = disabled;
  roundsInput.disabled = disabled;
  startButton.disabled = disabled;
  stopButton.disabled = !disabled;
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
  lines.push(`# 議題: ${topic}`);
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
  return input
    .toString()
    .trim()
    .toLowerCase()
    .slice(0, 40)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "discussion";
}

async function refreshState() {
  const response = await sendRuntimeMessage({ type: "GET_STATE" });
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

