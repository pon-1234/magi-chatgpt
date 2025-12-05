"use strict";

export const STORAGE_AREA = chrome.storage?.session ?? chrome.storage.local;
export const SYNC_STORAGE_AREA = chrome.storage?.sync ?? chrome.storage.local;

export function prepareChromeCall(fn, ...args) {
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

export function createTab(options) {
  return prepareChromeCall(chrome.tabs.create, options);
}

export function safeRemoveTab(tabId) {
  if (!tabId) return Promise.resolve();
  return prepareChromeCall(chrome.tabs.remove, tabId).catch(() => undefined);
}

export function getTab(tabId) {
  return prepareChromeCall(chrome.tabs.get, tabId);
}

export function sendMessageToTab(tabId, payload) {
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

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isNoReceivingEndError(error) {
  if (!error?.message) return false;
  return (
    error.message.includes("Receiving end does not exist") ||
    error.message.includes("No tab with id") ||
    error.message.includes("Could not establish connection. Receiving end does not exist.")
  );
}

export function isTransientError(error) {
  if (!error?.message) return false;
  const msg = error.message;
  // ChatGPT内部タイムアウトは多くの場合リトライしても改善しないため除外
  return (
    isNoReceivingEndError(error) ||
    msg.includes("The message port closed before a response was received")
  );
}

export function storageGet(area, keys) {
  return new Promise((resolve, reject) => {
    try {
      area.get(keys, (result) => {
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

export function storageSet(area, items) {
  return new Promise((resolve, reject) => {
    try {
      area.set(items, () => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}


