"use strict";

const store = browser.storage.local;

const CUSTOM_MODEL = "__custom__";

const PROVIDERS = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4-turbo", "o3-mini"],
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    models: ["deepseek-flash", "deepseek-v4-pro"],
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    models: [
      "claude-sonnet-4-20250514",
      "claude-opus-4-20250514",
      "claude-3-7-sonnet-latest",
      "claude-3-5-sonnet-latest",
      "claude-3-5-haiku-latest",
      "claude-3-haiku-20240307",
    ],
  },
};

const DEFAULTS = {
  provider: "openai",
  openMode: "sidebar",
  baseUrl: PROVIDERS.openai.baseUrl,
  apiKey: "",
  model: "gpt-4o-mini",
  systemPrompt:
    "You are a helpful, concise assistant inside a browser sidebar. When the user shares a webpage or a screenshot, use that context to answer accurately. Use fenced code blocks for code.",
  temperature: 0.7,
  maxTokens: 4096,
};

const els = {};
function $(id) { return document.getElementById(id); }

document.addEventListener("DOMContentLoaded", init);

async function init() {
  ["provider", "baseUrl", "apiKey", "model", "customModel", "systemPrompt", "temperature", "maxTokens", "saveBtn", "testBtn", "status", "showKey"].forEach(
    (id) => (els[id] = $(id)),
  );

  const { settings } = await store.get("settings");
  const s = { ...DEFAULTS, ...(settings || {}) };

  els.provider.addEventListener("change", onProviderChange);
  els.model.addEventListener("change", onModelChange);
  els.saveBtn.addEventListener("click", save);
  els.testBtn.addEventListener("click", test);
  els.showKey.addEventListener("change", () => {
    els.apiKey.type = els.showKey.checked ? "text" : "password";
  });

  fill(s);
}

function populateModels(provider) {
  const p = PROVIDERS[provider] || PROVIDERS.openai;
  const sel = els.model;
  sel.innerHTML = "";
  p.models.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    sel.appendChild(opt);
  });
  const custom = document.createElement("option");
  custom.value = CUSTOM_MODEL;
  custom.textContent = "Custom model…";
  sel.appendChild(custom);
}

function onModelChange() {
  const isCustom = els.model.value === CUSTOM_MODEL;
  els.customModel.classList.toggle("hidden", !isCustom);
  if (isCustom) els.customModel.focus();
}

function onProviderChange() {
  const p = PROVIDERS[els.provider.value] || PROVIDERS.openai;
  els.baseUrl.value = p.baseUrl;
  els.customModel.value = "";
  populateModels(els.provider.value);
  els.model.value = p.models[0];
  onModelChange();
}

function fill(s) {
  const provider = PROVIDERS[s.provider] ? s.provider : "openai";
  els.provider.value = provider;
  els.baseUrl.value = s.baseUrl || PROVIDERS[provider].baseUrl;
  els.apiKey.value = s.apiKey;
  els.systemPrompt.value = s.systemPrompt;
  els.temperature.value = s.temperature;
  els.maxTokens.value = s.maxTokens;
  setOpenMode(s.openMode === "popup" ? "popup" : "sidebar");

  populateModels(provider);
  if (s.model && PROVIDERS[provider].models.includes(s.model)) {
    els.model.value = s.model;
  } else {
    els.model.value = CUSTOM_MODEL;
    els.customModel.value = s.model || "";
  }
  onModelChange();
}

function readOpenMode() {
  const el = document.querySelector('input[name="openMode"]:checked');
  return el ? el.value : "sidebar";
}

function setOpenMode(mode) {
  document.querySelectorAll('input[name="openMode"]').forEach((r) => {
    r.checked = r.value === mode;
  });
}

function current() {
  const model = els.model.value === CUSTOM_MODEL ? els.customModel.value.trim() : els.model.value;
  return {
    provider: els.provider.value,
    openMode: readOpenMode(),
    baseUrl: els.baseUrl.value.trim(),
    apiKey: els.apiKey.value.trim(),
    model,
    systemPrompt: els.systemPrompt.value,
    temperature: parseFloat(els.temperature.value) || 0.7,
    maxTokens: parseInt(els.maxTokens.value, 10) || 4096,
  };
}

async function save() {
  await store.set({ settings: current() });
  setStatus("Saved ✓", true);
}

function setStatus(text, ok) {
  els.status.textContent = text;
  els.status.className = "status " + (ok ? "ok" : "err");
  const snapshot = text;
  setTimeout(() => {
    if (els.status.textContent === snapshot) {
      els.status.textContent = "";
      els.status.className = "status";
    }
  }, 3000);
}

async function test() {
  const s = current();
  if (!s.apiKey) {
    setStatus("Enter an API key first", false);
    return;
  }
  els.testBtn.disabled = true;
  els.testBtn.textContent = "Testing…";
  try {
    const { url, headers, body } = buildTestRequest(s);
    const resp = await fetch(url, { method: "POST", headers, body });
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error("HTTP " + resp.status + ": " + summarizeError(t));
    }
    setStatus("Connection OK ✓", true);
  } catch (err) {
    setStatus("Error: " + err.message, false);
  } finally {
    els.testBtn.disabled = false;
    els.testBtn.textContent = "Test connection";
  }
}

function buildTestRequest(s) {
  if (s.provider === "anthropic") {
    const base = s.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
    return {
      url: base + "/v1/messages",
      headers: {
        "content-type": "application/json",
        "x-api-key": s.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: s.model,
        max_tokens: 16,
        system: "",
        messages: [{ role: "user", content: "ping" }],
      }),
    };
  }
  const base = s.baseUrl.replace(/\/+$/, "");
  return {
    url: base + "/chat/completions",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + s.apiKey,
    },
    body: JSON.stringify({
      model: s.model,
      max_tokens: 16,
      messages: [{ role: "user", content: "ping" }],
    }),
  };
}

function summarizeError(text) {
  try {
    const j = JSON.parse(text);
    if (j.error && j.error.message) return j.error.message;
    if (j.error && typeof j.error === "string") return j.error;
  } catch (e) {
    /* not JSON */
  }
  return text.slice(0, 300);
}
