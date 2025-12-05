"use strict";

const DEFAULT_RESPONSE_TIMEOUT = 300_000;
const COMPOSER_WAIT_TIMEOUT = 60_000;
const COMPOSER_SELECTORS = [
  'div[contenteditable="true"][data-testid="textbox"]',
  'textarea[data-testid="prompt-textarea"]',
  "#prompt-textarea",
  'textarea[data-id="root"]',
  'textarea[data-testid="textbox"]',
  'textarea[placeholder*="Send a message"]',
  'textarea[placeholder*="メッセージ"]',
  'div[contenteditable="true"][aria-label*="メッセージ"]',
  // フォールバック: 画面下部にあるcontenteditableな入力欄らしき要素
  'main div[contenteditable="true"]:not([contenteditable="false"])',
];

const ASSISTANT_MESSAGE_SELECTOR =
  '[data-message-author-role^="assistant"],' +
  '[data-message-author-role="model"],' +
  '[data-testid="assistant-message"]';

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

const STOP_BUTTON_SELECTORS = [
  'button[data-testid="stop-button"]',
  'button[aria-label*="Stop generating"]',
  'button[aria-label*="停止"]',
];

const STOP_BUTTON_TEXT_PATTERNS = [/stop\s+generating/i, /生成を停止/, /生成を中断/, /停止する/];

let isBusy = false;
let currentPromptAbortController = null;
const ABORT_DEFAULT_MESSAGE = "ユーザー操作により処理を中断しました。";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PING") {
    sendResponse({ status: "ok" });
    return;
  }

  if (message?.type === "ABORT_PROMPT") {
    const reason = message?.reason || ABORT_DEFAULT_MESSAGE;
    const controller = currentPromptAbortController;
    let aborted = false;
    if (controller && !controller.signal.aborted) {
      setAbortReason(controller.signal, reason);
      controller.abort(reason);
      aborted = true;
    }
    const stopClicked = clickStopGeneratingButton();
    sendResponse({ status: "ok", aborted, stopClicked });
    return;
  }

  if (message?.type === "SEND_PROMPT") {
    if (isBusy) {
      sendResponse({
        status: "error",
        message: "このタブは前のプロンプトを処理中です。しばらく待ってください。",
      });
      return;
    }

    isBusy = true;
    const abortController = new AbortController();
    currentPromptAbortController = abortController;
    handleSendPrompt(message, abortController.signal)
      .then((data) => sendResponse({ status: "ok", data }))
      .catch((error) => sendResponse({ status: "error", message: error.message }))
      .finally(() => {
        if (currentPromptAbortController === abortController) {
          currentPromptAbortController = null;
        }
        isBusy = false;
      });
    return true;
  }

  return false;
});

async function handleSendPrompt({ prompt, timeout = DEFAULT_RESPONSE_TIMEOUT }, signal) {
  ensureNotAborted(signal);
  const composer = await waitForComposer({ signal });
  const knownIds = collectAssistantIds();
  await focusComposer(composer, signal);
  await fillComposer(composer, prompt, signal);
  const currentText = readComposerText(composer);
  const normalizedPrompt = normalizeWhitespace(prompt);
  const normalizedCurrent = normalizeWhitespace(currentText);
  if (!normalizedCurrent) {
    throw new Error("入力欄への書き込みに失敗しました（テキストが空のままです）。");
  }
  if (normalizedPrompt && normalizedPrompt !== normalizedCurrent) {
    throw new Error("入力欄に正しいテキストを書き込めませんでした。");
  }
  await triggerSend(composer, signal);
  const response = await waitForNewAssistantResponse(knownIds, { timeout, signal });
  return response;
}

async function waitForComposer({ timeout = COMPOSER_WAIT_TIMEOUT, signal } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    ensureNotAborted(signal);
    for (const selector of COMPOSER_SELECTORS) {
      const element = document.querySelector(selector);
      if (isComposer(element)) {
        return element;
      }
    }
    await delay(500);
    ensureNotAborted(signal);
  }
  ensureNotAborted(signal);
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

async function focusComposer(element, signal) {
  ensureNotAborted(signal);
  element.focus();
  await delay(50);
  ensureNotAborted(signal);
}

async function fillComposer(element, text, signal) {
  ensureNotAborted(signal);
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
  ensureNotAborted(signal);
}

function readComposerText(element) {
  if (!element) return "";
  if (element.tagName === "TEXTAREA" || element.tagName === "INPUT") {
    return element.value || "";
  }
  if (element.isContentEditable) {
    return element.textContent || "";
  }
  return "";
}

async function triggerSend(element, signal) {
  ensureNotAborted(signal);
  const sendButton = findSendButton(element);
  if (sendButton) {
    sendButton.removeAttribute("disabled");
    sendButton.click();
    await delay(200);
    ensureNotAborted(signal);
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
  ensureNotAborted(signal);
}

function findSendButton(element) {
  const selectors = [
    'button[data-testid="send-button"]',
    'button[aria-label*="Send"]',
    'button[aria-label*="送信"]',
    'button[type="submit"]',
  ];

  const roots = [];
  if (element) {
    const form = element.closest("form");
    if (form) roots.push(form);
    const wrapper =
      element.closest('[data-testid="composer"]') ||
      element.closest('[data-testid="prompt-wrapper"]') ||
      element.parentElement;
    if (wrapper) roots.push(wrapper);
  }

  for (const root of roots) {
    if (!root) continue;
    for (const selector of selectors) {
      const button = root.querySelector(selector);
      if (button) return button;
    }
  }

  for (const selector of selectors) {
    const button = document.querySelector(selector);
    if (button) return button;
  }
  return null;
}

function collectAssistantIds() {
  return new Set(
    Array.from(document.querySelectorAll(ASSISTANT_MESSAGE_SELECTOR)).map((node, index) =>
      getMessageId(node, index)
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

function getLastUserMessageText() {
  const nodes = Array.from(document.querySelectorAll('[data-message-author-role="user"]'));
  const last = nodes[nodes.length - 1];
  return last?.innerText?.trim() || "";
}

async function waitForNewAssistantResponse(knownIds, { timeout = DEFAULT_RESPONSE_TIMEOUT, signal } = {}) {
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
      if (signal) {
        signal.removeEventListener("abort", handleAbort);
      }
    };

    const rejectWith = (message) => {
      cleanup();
      reject(new Error(message));
    };

    const handleAbort = () => {
      rejectWith(getAbortReason(signal));
    };

    if (signal) {
      if (signal.aborted) {
        rejectWith(getAbortReason(signal));
        return;
      }
      signal.addEventListener("abort", handleAbort, { once: true });
    }

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
      if (signal?.aborted) {
        return;
      }
      if (isGenerating()) return;
      const stableFor = Date.now() - lastMessage.changedAt;
      if (stableFor < 500) return;
      knownIds.add(lastMessage.id);
      cleanup();
      resolve({
        text: lastMessage.text,
        html: lastMessage.html,
        id: lastMessage.id,
        lastUserText: getLastUserMessageText(),
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

      const nodes = Array.from(document.querySelectorAll(ASSISTANT_MESSAGE_SELECTOR));

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

function clickStopGeneratingButton() {
  for (const selector of STOP_BUTTON_SELECTORS) {
    const button = document.querySelector(selector);
    if (button && !button.disabled) {
      button.click();
      return true;
    }
  }

  const buttons = Array.from(document.querySelectorAll("button"));
  for (const button of buttons) {
    if (button.disabled) continue;
    const text = button.textContent?.trim() || "";
    const aria = button.getAttribute("aria-label") || "";
    if (
      STOP_BUTTON_TEXT_PATTERNS.some((pattern) => pattern.test(text)) ||
      STOP_BUTTON_TEXT_PATTERNS.some((pattern) => pattern.test(aria))
    ) {
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

function normalizeWhitespace(input) {
  if (input == null) return "";
  return input.toString().replace(/\s+/g, " ").trim();
}

function ensureNotAborted(signal, fallback = ABORT_DEFAULT_MESSAGE) {
  if (signal?.aborted) {
    throw new Error(getAbortReason(signal, fallback));
  }
}

function getAbortReason(signal, fallback = ABORT_DEFAULT_MESSAGE) {
  if (!signal) return fallback;
  const reason = signal.reason ?? signal.__magiAbortReason;
  if (!reason) return fallback;
  if (typeof reason === "string") return reason;
  if (reason instanceof Error) return reason.message;
  try {
    return String(reason);
  } catch {
    return fallback;
  }
}

function setAbortReason(signal, reason) {
  if (!signal || !reason) return;
  try {
    Object.defineProperty(signal, "__magiAbortReason", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: reason,
    });
  } catch {
    signal.__magiAbortReason = reason;
  }
}
