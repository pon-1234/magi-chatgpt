const form = document.getElementById("control-form");
const topicInput = document.getElementById("topic-input");
const roundsInput = document.getElementById("rounds-input");
const statusBadge = document.getElementById("status");
const logView = document.getElementById("log-view");
const summaryView = document.getElementById("summary-view");
const clearLogButton = document.getElementById("clear-log-btn");
const startButton = document.getElementById("start-btn");
const stopButton = document.getElementById("stop-btn");

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

function renderState(state) {
  if (!state) return;

  statusBadge.textContent = state.running ? "実行中" : "待機中";
  statusBadge.classList.toggle("running", Boolean(state.running));
  setFormDisabled(Boolean(state.running));

  if (state.logs?.length) {
    logView.textContent = state.logs
      .map((entry) => formatLogEntry(entry))
      .join("\n");
    logView.scrollTop = logView.scrollHeight;
  }

  if (state.summary) {
    renderSummary(state.summary);
  }
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

