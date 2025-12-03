"use strict";

import { MSG, EVENT } from "./messages.js";
import {
  state,
  ensureStateReady,
  ensureSettingsReady,
  getPublicState,
  pushLog,
  notify,
  notifyState,
  resolveModeKey,
  scheduleStatePersist,
  getSettings,
  updateSettings,
  shouldResumeWorkflow,
  consumeResumeFlag,
} from "./background/state.js";
import {
  startDiscussion,
  resumeDiscussionWorkflow,
  abortAllAgentPrompts,
} from "./background/workflow.js";

chrome.runtime.onStartup.addListener(() => {
  ensureStateReady().then(() => {
    if (shouldResumeWorkflow()) {
      consumeResumeFlag();
      resumeDiscussionWorkflow();
    }
  });
});

(async () => {
  await ensureStateReady();
  if (shouldResumeWorkflow()) {
    consumeResumeFlag();
    resumeDiscussionWorkflow();
  }
})();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case MSG.START_DISCUSSION: {
    (async () => {
      try {
        await ensureStateReady();
        const topic = (message.topic || "").trim();
        const rounds = Number(message.rounds) || 3;
          const requestedMode = resolveModeKey(message.mode) ?? state.mode;
          const modeKey = requestedMode || state.mode;

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
            notify({ type: EVENT.DISCUSSION_ERROR, message: error.message });
        });
      } catch (error) {
        sendResponse({ status: "error", message: error.message });
      }
    })();
    return true;
  }

    case MSG.GET_STATE: {
    (async () => {
      try {
        await ensureStateReady();
          sendResponse({ status: "ok", state: getPublicState() });
      } catch (error) {
        sendResponse({ status: "error", message: error.message });
      }
    })();
    return true;
  }

    case MSG.STOP_DISCUSSION: {
    (async () => {
      try {
        await ensureStateReady();
        if (!state.running) {
          sendResponse({ status: "ok" });
          return;
        }
        state.stopRequested = true;
        pushLog("ユーザーから議論停止要求を受信しました。現在のラウンド終了後に停止します。");
        await abortAllAgentPrompts("ユーザーによって議論が停止されました。");
        notifyState();
        sendResponse({ status: "ok" });
      } catch (error) {
        sendResponse({ status: "error", message: error.message });
      }
    })();
    return true;
  }

    case MSG.CLEAR_LOGS: {
    (async () => {
      try {
        await ensureStateReady();
        state.logs = [];
        scheduleStatePersist();
        notifyState();
        sendResponse({ status: "ok" });
      } catch (error) {
        sendResponse({ status: "error", message: error.message });
      }
    })();
    return true;
  }

    case MSG.SET_MODE: {
    (async () => {
      try {
        await ensureStateReady();
          const requested = resolveModeKey(message.mode) ?? state.mode;
          if (!requested) {
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

    case MSG.GET_SETTINGS: {
      (async () => {
        try {
          await ensureSettingsReady();
          sendResponse({ status: "ok", settings: getSettings() });
        } catch (error) {
          sendResponse({ status: "error", message: error.message });
        }
      })();
      return true;
    }

    case MSG.UPDATE_SETTINGS: {
      (async () => {
        try {
          await ensureSettingsReady();
          await updateSettings(message.settings || {});
          sendResponse({ status: "ok", settings: getSettings() });
      } catch (error) {
          sendResponse({ status: "error", message: error.message });
    }
  })();
      return true;
    }

    default:
      return undefined;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const index = state.agentTabs.findIndex((tab) => tab.tabId === tabId);
  if (index >= 0) {
    const removed = state.agentTabs[index];
    state.agentTabs.splice(index, 1);
    pushLog(`【${removed.name}】 のタブ (${tabId}) が閉じられました。必要であれば議論を再実行してください。`);
    notify({ type: EVENT.AGENT_TAB_CLOSED, tabId, agentName: removed.name });
  notifyState();
}
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (state.agentWindowId === windowId) {
      state.agentWindowId = null;
      notifyState();
    }
});


