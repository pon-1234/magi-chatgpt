"use strict";

const DEFAULT_RESPONSE_TIMEOUT = 600_000;
const COMPOSER_WAIT_TIMEOUT = 60_000;
const COMPOSER_SELECTORS = [
  'textarea[data-id="root"]',
  'textarea[data-testid="textbox"]',
  'textarea[placeholder*="Send a message"]',
  "#prompt-textarea",
  'div[contenteditable="true"][data-placeholder]',
  "form textarea",
];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PING") {
    sendResponse({ status: "ok" });
    return;
  }

  if (message?.type === "SEND_PROMPT") {
    handleSendPrompt(message)
      .then((data) => sendResponse({ status: "ok", data }))
      .catch((error) => sendResponse({ status: "error", error: error.message }));
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
  throw new Error("入力欄を検出できませんでした。ChatGPTにログイン済みか確認してください。");
}

function isComposer(element) {
  if (!element) return false;
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
    element.dispatchEvent(
      new InputEvent("input", { bubbles: true, data: text })
    );
  } else if (element.isContentEditable) {
    element.textContent = text;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(
      new InputEvent("input", { bubbles: true, data: text })
    );
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
    Array.from(
      document.querySelectorAll('[data-message-author-role="assistant"]')
    ).map((node, index) => getMessageId(node, index))
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

async function waitForNewAssistantResponse(
  knownIds,
  timeout = DEFAULT_RESPONSE_TIMEOUT
) {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    let observer;
    let intervalId;

    const cleanup = () => {
      observer?.disconnect();
      if (intervalId) {
        clearInterval(intervalId);
      }
    };

    const checkForResponse = () => {
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
        if (text) {
          knownIds.add(id);
          cleanup();
          resolve({
            text,
            html: node.innerHTML,
            id,
          });
          return;
        }
      }

      if (Date.now() - start > timeout) {
        cleanup();
        reject(new Error("ChatGPTの応答待ちがタイムアウトしました。"));
      }
    };

    observer = new MutationObserver(() => checkForResponse());
    observer.observe(document.body, { childList: true, subtree: true });

    intervalId = setInterval(() => checkForResponse(), 1000);

    checkForResponse();
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

