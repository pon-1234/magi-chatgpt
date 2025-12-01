"use strict";

const DEFAULT_RESPONSE_TIMEOUT = 600_000;
const COMPOSER_WAIT_TIMEOUT = 60_000;
const COMPOSER_SELECTORS = [
  'textarea[data-id="root"]',
  'textarea[data-testid="textbox"]',
  'textarea[data-testid="prompt-textarea"]',
  'textarea[placeholder*="Send a message"]',
  'textarea[placeholder*="メッセージ"]',
  "#prompt-textarea",
  'div[contenteditable="true"][data-testid="textbox"]',
  'div[contenteditable="true"][data-placeholder]',
  'div[contenteditable="true"][aria-label*="メッセージ"]',
  "form textarea",
];

const CONTINUE_BUTTON_PATTERNS = [
  /continue\s+generating/i,
  /continue\s+writing/i,
  /resume\s+generating/i,
  /generate\s+anyway/i,
  /生成を続ける/,
  /生成を再開/,
  /生成を継続/,
  /続けて生成/,
];

const BLOCKING_TEXT_PATTERNS = [
  { pattern: /something went wrong/i, message: "ChatGPT側でエラーが発生しました。ページを再読み込みしてください。" },
  { pattern: /please log in/i, message: "ChatGPTにログインしてください。" },
  { pattern: /session expired/i, message: "ChatGPTのセッションが期限切れです。再ログインしてください。" },
  { pattern: /network error/i, message: "ChatGPTでネットワークエラーが発生しました。" },
];

let isBusy = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PING") {
    sendResponse({ status: "ok" });
    return;
  }

  if (message?.type === "SEND_PROMPT") {
    if (isBusy) {
      sendResponse({
        status: "error",
        error: "このタブは前のプロンプトを処理中です。しばらく待ってください。",
      });
      return;
    }

    isBusy = true;
    handleSendPrompt(message)
      .then((data) => sendResponse({ status: "ok", data }))
      .catch((error) => sendResponse({ status: "error", error: error.message }))
      .finally(() => {
        isBusy = false;
      });
    return true;
  }

  return false;
});

async function handleSendPrompt({ prompt, timeout = DEFAULT_RESPONSE_TIMEOUT }) {
  const composer = await waitForComposer();
  const knownIds = collectAssistantIds();
  await focusComposer(composer);
  await fillComposer(composer, prompt);
  await triggerSend(composer);
  const response = await waitForNewAssistantResponse(knownIds, timeout);
  return response;
}

async function waitForComposer(timeout = COMPOSER_WAIT_TIMEOUT) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const selector of COMPOSER_SELECTORS) {
      const element = document.querySelector(selector);
      if (isComposer(element)) {
        return element;
      }
    }
    await delay(500);
  }
  throw new Error(
    "入力欄を検出できませんでした。ChatGPTにログイン済みか確認し、一度手動でメッセージ欄をクリックしてから再実行してください（UIが変わっている場合は拡張機能のアップデートをお待ちください）。"
  );
}

function isComposer(element) {
  if (!element) return false;
  if (element.offsetParent === null && element !== document.activeElement) {
    return false;
  }
  if (element.tagName === "TEXTAREA" || element.tagName === "INPUT") {
    return !element.disabled;
  }
  if (element.isContentEditable) {
    return true;
  }
  return false;
}

async function focusComposer(element) {
  element.focus();
  await delay(50);
}

async function fillComposer(element, text) {
  if (element.tagName === "TEXTAREA" || element.tagName === "INPUT") {
    element.value = text;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
  } else if (element.isContentEditable) {
    element.textContent = text;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
  } else {
    throw new Error("入力欄への書き込みに失敗しました。");
  }
  await delay(100);
}

async function triggerSend(element) {
  const form = element.closest("form");
  const sendButton =
    document.querySelector('button[data-testid="send-button"]') ||
    form?.querySelector('button[type="submit"]');
  if (sendButton) {
    sendButton.removeAttribute("disabled");
    sendButton.click();
    await delay(200);
    return;
  }

  element.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    })
  );
  element.dispatchEvent(
    new KeyboardEvent("keyup", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    })
  );
  await delay(200);
}

function collectAssistantIds() {
  return new Set(
    Array.from(document.querySelectorAll('[data-message-author-role="assistant"]')).map(
      (node, index) => getMessageId(node, index)
    )
  );
}

function getMessageId(node, index = 0) {
  return (
    node?.getAttribute("data-message-id") ||
    node?.id ||
    node?.dataset?.messageId ||
    `assistant-${index}-${node?.textContent?.length ?? 0}`
  );
}

async function waitForNewAssistantResponse(knownIds, timeout = DEFAULT_RESPONSE_TIMEOUT) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    let observer;
    let intervalId;
    let continueIntervalId;
    let lastMessage = null;

    const cleanup = () => {
      observer?.disconnect();
      if (intervalId) {
        clearInterval(intervalId);
      }
      if (continueIntervalId) {
        clearInterval(continueIntervalId);
      }
    };

    const isGenerating = () => {
      if (
        document.querySelector('button[data-testid="stop-button"]') ||
        document.querySelector('button[aria-label*="Stop generating"]')
      ) {
        return true;
      }
      return clickContinueButtonIfPresent();
    };

    const finalizeIfStable = () => {
      if (!lastMessage) return;
      if (isGenerating()) return;
      const stableFor = Date.now() - lastMessage.changedAt;
      if (stableFor < 500) return;
      knownIds.add(lastMessage.id);
      cleanup();
      resolve({
        text: lastMessage.text,
        html: lastMessage.html,
        id: lastMessage.id,
      });
    };

    const checkForResponse = () => {
      if (Date.now() - start > timeout) {
        cleanup();
        reject(new Error("ChatGPTの応答待ちがタイムアウトしました。"));
        return;
      }

      clickContinueButtonIfPresent();

      const blockingIssue = detectBlockingIssues();
      if (blockingIssue) {
        cleanup();
        reject(new Error(blockingIssue));
        return;
      }

      const nodes = Array.from(
        document.querySelectorAll('[data-message-author-role="assistant"]')
      );

      for (let index = nodes.length - 1; index >= 0; index -= 1) {
        const node = nodes[index];
        const id = getMessageId(node, index);
        if (knownIds.has(id)) {
          continue;
        }

        const text = node.innerText?.trim();
        if (!text) {
          continue;
        }

        const html = node.innerHTML;
        if (!lastMessage || lastMessage.id !== id || lastMessage.text !== text) {
          lastMessage = {
            id,
            text,
            html,
            node,
            changedAt: Date.now(),
          };
        }
        break;
      }

      finalizeIfStable();
    };

    observer = new MutationObserver(() => checkForResponse());
    observer.observe(document.body, { childList: true, subtree: true });

    intervalId = setInterval(() => checkForResponse(), 1000);
    continueIntervalId = setInterval(() => clickContinueButtonIfPresent(), 1500);

    checkForResponse();
  });
}

function clickContinueButtonIfPresent() {
  const buttons = Array.from(document.querySelectorAll("button"));
  for (const button of buttons) {
    if (button.disabled) continue;
    const text = button.textContent?.trim() ?? "";
    const aria = button.getAttribute("aria-label") || "";
    const testId = button.dataset?.testid || "";
    if (isContinueButtonMatch(text) || isContinueButtonMatch(aria) || /continue/i.test(testId)) {
      button.click();
      return true;
    }
  }
  return false;
}

function isContinueButtonMatch(text) {
  if (!text) return false;
  if (CONTINUE_BUTTON_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  if (/continue/i.test(text) && !/continue with/i.test(text)) {
    return true;
  }
  return false;
}

function detectBlockingIssues() {
  if (document.querySelector('button[data-testid="login-button"]')) {
    return "ChatGPTにログインしてください。";
  }
  const bodyText = document.body?.innerText || "";
  for (const { pattern, message } of BLOCKING_TEXT_PATTERNS) {
    if (pattern.test(bodyText)) {
      return message;
    }
  }
  return null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
