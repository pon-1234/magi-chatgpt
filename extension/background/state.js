"use strict";

import { MODE_DEFINITIONS, DEFAULT_MODE_KEY } from "./prompt-templates.js";
import { EVENT } from "../messages.js";
import { STORAGE_AREA, SYNC_STORAGE_AREA, storageGet, storageSet } from "./chrome-helpers.js";

const STORAGE_KEY = "magi_state";
const SETTINGS_KEY = "magi_settings";
const STATE_PERSIST_DEBOUNCE_MS = 250;
const MAX_LOG_ENTRIES = 500;

const DEFAULT_SETTINGS = Object.freeze({
  responseTimeoutMs: 1_200_000,
  tabRefocusIntervalMs: 45_000,
});

export const state = {
  running: false,
  mode: DEFAULT_MODE_KEY,
  activeMode: null,
  topic: "",
  plannedRounds: 3,
  agentTabs: [],
  logs: [],
  roundLogs: [],
  summary: "",
  agentWindowId: null,
  stopRequested: false,
  initialCritique: "",
  settings: { ...DEFAULT_SETTINGS },
};

let persistTimerId = null;
let stateReadyPromise = null;
let settingsReadyPromise = null;
let resumePending = false;

bootstrapState();

function bootstrapState() {
  stateReadyPromise = restoreState();
  settingsReadyPromise = restoreSettings();
}

export async function ensureStateReady() {
  if (!stateReadyPromise) return;
  try {
    await stateReadyPromise;
  } catch (error) {
    console.warn("MAGI state restoration failed:", error);
  }
}

export async function ensureSettingsReady() {
  if (!settingsReadyPromise) return;
  try {
    await settingsReadyPromise;
  } catch (error) {
    console.warn("MAGI settings restoration failed:", error);
  }
}

export function shouldResumeWorkflow() {
  return resumePending;
}

export function consumeResumeFlag() {
  const flag = resumePending;
  resumePending = false;
  return flag;
}

export function resolveModeKey(input) {
  if (!input) return null;
  const normalized = String(input).trim().toLowerCase();
  if (MODE_DEFINITIONS[normalized]) {
    return normalized;
  }
  if (normalized === "dev" || normalized === "development" || normalized === "system-development") {
    return "development";
  }
  if (normalized === "default") {
    return DEFAULT_MODE_KEY;
  }
  return null;
}

export function getModeDefinition(modeKey = getEffectiveMode()) {
  if (MODE_DEFINITIONS[modeKey]) {
    return MODE_DEFINITIONS[modeKey];
  }
  return MODE_DEFINITIONS[DEFAULT_MODE_KEY];
}

export function getEffectiveMode() {
  return state.activeMode || state.mode || DEFAULT_MODE_KEY;
}

export function getModeLabel(modeKey) {
  const definition = getModeDefinition(modeKey);
  return definition?.label ?? "汎用モード";
}

export function getAgentDefinitions(modeKey = getEffectiveMode()) {
  const definition = getModeDefinition(modeKey);
  return definition.agents;
}

export function getSettings() {
  return { ...state.settings };
}

export async function updateSettings(partial = {}) {
  await ensureSettingsReady();
  const next = {
    ...state.settings,
    ...sanitizeSettings(partial),
  };
  state.settings = next;
  await persistSettings();
  notifySettingsUpdated();
  notifyState();
}

function sanitizeSettings(partial) {
  const sanitized = {};
  if ("responseTimeoutMs" in partial) {
    sanitized.responseTimeoutMs = clampNumber(
      partial.responseTimeoutMs,
      60_000,
      1_200_000,
      DEFAULT_SETTINGS.responseTimeoutMs
    );
  }
  if ("tabRefocusIntervalMs" in partial) {
    sanitized.tabRefocusIntervalMs = clampNumber(
      partial.tabRefocusIntervalMs,
      10_000,
      300_000,
      DEFAULT_SETTINGS.tabRefocusIntervalMs
    );
  }
  return sanitized;
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  return Math.min(Math.max(num, min), max);
}

async function restoreState() {
  if (!STORAGE_AREA) {
    return;
  }
  try {
    const stored = await storageGet(STORAGE_AREA, STORAGE_KEY);
    const snapshot = stored?.[STORAGE_KEY];
    if (!snapshot) {
      resumePending = false;
      return;
    }
    applyStateSnapshot(snapshot);
    notifyState();
    resumePending = state.running;
  } catch (error) {
    resumePending = false;
    console.warn("MAGI state restore error:", error);
  }
}

async function restoreSettings() {
  if (!SYNC_STORAGE_AREA) {
    return;
  }
  try {
    const stored = await storageGet(SYNC_STORAGE_AREA, SETTINGS_KEY);
    const snapshot = stored?.[SETTINGS_KEY];
    if (snapshot) {
      state.settings = {
        ...DEFAULT_SETTINGS,
        ...sanitizeSettings(snapshot),
      };
    } else {
      state.settings = { ...DEFAULT_SETTINGS };
    }
  } catch (error) {
    console.warn("MAGI settings restore error:", error);
    state.settings = { ...DEFAULT_SETTINGS };
  }
}

async function persistSettings() {
  if (!SYNC_STORAGE_AREA) return;
  try {
    await storageSet(SYNC_STORAGE_AREA, { [SETTINGS_KEY]: state.settings });
  } catch (error) {
    console.warn("MAGI settings persist error:", error);
  }
}

export function pushLog(message) {
  const entry = {
    timestamp: new Date().toISOString(),
    message,
  };
  state.logs.push(entry);
  if (state.logs.length > MAX_LOG_ENTRIES) {
    state.logs.splice(0, state.logs.length - MAX_LOG_ENTRIES);
  }
  scheduleStatePersist();
  notify({ type: EVENT.LOG, entry });
  console.log("[MAGI]", message);
}

export function notify(event) {
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

export function getPublicState() {
  const effectiveMode = getEffectiveMode();
  return {
    running: state.running,
    mode: state.mode ?? DEFAULT_MODE_KEY,
    activeMode: state.activeMode,
    effectiveMode,
    modeLabel: getModeLabel(effectiveMode),
    topic: state.topic,
    plannedRounds: state.plannedRounds,
    logs: state.logs,
    roundLogs: state.roundLogs,
    summary: state.summary,
    agents: state.agentTabs.map(({ name, tabId }) => ({ name, tabId })),
    stopRequested: state.stopRequested,
    initialCritique: state.initialCritique || "",
    settings: { ...state.settings },
  };
}

export function notifyState() {
  const publicState = getPublicState();
  scheduleStatePersist();
  notify({
    type: EVENT.STATE_UPDATE,
    state: publicState,
  });
}

export function notifySettingsUpdated() {
  notify({
    type: EVENT.SETTINGS_UPDATED,
    settings: { ...state.settings },
  });
}

export function scheduleStatePersist() {
  if (!STORAGE_AREA) return;
  if (persistTimerId != null) return;
  persistTimerId = setTimeout(() => {
    persistTimerId = null;
    persistState();
  }, STATE_PERSIST_DEBOUNCE_MS);
}

async function persistState() {
  if (!STORAGE_AREA) {
    return;
  }
  const snapshot = serializeState();
  try {
    await storageSet(STORAGE_AREA, { [STORAGE_KEY]: snapshot });
  } catch (error) {
    console.warn("MAGI state persist error:", error);
  }
}

function serializeState() {
  return {
    running: state.running,
    mode: state.mode,
    activeMode: state.activeMode,
    topic: state.topic,
    plannedRounds: state.plannedRounds,
    agentTabs: state.agentTabs.map(({ name, tabId }) => ({ name, tabId })),
    agentWindowId: state.agentWindowId ?? null,
    logs: state.logs,
    roundLogs: state.roundLogs,
    summary: state.summary,
    stopRequested: state.stopRequested,
    initialCritique: state.initialCritique || "",
  };
}

function applyStateSnapshot(snapshot) {
  state.running = Boolean(snapshot.running);
  const storedMode = resolveModeKey(snapshot.mode) ?? DEFAULT_MODE_KEY;
  const storedActiveMode = resolveModeKey(snapshot.activeMode) ?? (state.running ? storedMode : null);
  state.mode = storedMode;
  state.activeMode = storedActiveMode;
  state.topic = snapshot.topic ?? "";
  state.plannedRounds = Number(snapshot.plannedRounds) || 3;
  state.roundLogs = normalizeRoundLogs(snapshot.roundLogs);
  state.summary = snapshot.summary ?? "";
  state.logs = Array.isArray(snapshot.logs)
    ? snapshot.logs.slice(-MAX_LOG_ENTRIES)
    : [];
  state.agentWindowId = snapshot.agentWindowId ?? null;
  state.stopRequested = Boolean(snapshot.stopRequested);
  state.agentTabs = hydrateAgentTabs(snapshot.agentTabs, storedActiveMode || storedMode);
  state.initialCritique = snapshot.initialCritique || "";
}

function hydrateAgentTabs(savedTabs, modeKey = DEFAULT_MODE_KEY) {
  if (!Array.isArray(savedTabs)) {
    return [];
  }
  const agents = getAgentDefinitions(modeKey);
  return savedTabs
    .map((entry) => {
      if (!entry?.name || !entry?.tabId) {
        return null;
      }
      const definition = agents.find((agent) => agent.name === entry.name);
      if (!definition) {
        return null;
      }
      return { ...definition, tabId: entry.tabId };
    })
    .filter(Boolean);
}

function normalizeRoundLogs(rawRounds) {
  if (!Array.isArray(rawRounds)) {
    return [];
  }
  return rawRounds.map((entry, index) => {
    if (entry && typeof entry === "object" && "participants" in entry) {
      return {
        round: entry.round ?? index + 1,
        participants: entry.participants ?? {},
        analyst: entry.analyst ?? "",
      };
    }

    const participants = { ...(entry || {}) };
    const analyst = participants.ANALYST ?? participants.analyst ?? "";
    delete participants.ANALYST;
    delete participants.analyst;

    return {
      round: index + 1,
      participants,
      analyst,
    };
  });
}


