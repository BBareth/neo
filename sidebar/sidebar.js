"use strict";

/* ===========================================================================
   Neo AI Sidebar — client script
   Handles conversations, chat with the configured AI provider (OpenAI-
   compatible or Anthropic), adding open pages, and screenshots.
   ========================================================================== */

const store = browser.storage.local;

const DEFAULT_SETTINGS = {
  provider: "openai",
  openMode: "sidebar",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  systemPrompt:
    "You are a helpful, concise assistant inside a browser sidebar. When the user shares a webpage or a screenshot, use that context to answer accurately. Use fenced code blocks for code.",
  temperature: 0.7,
  maxTokens: 4096,
};

const state = {
  settings: { ...DEFAULT_SETTINGS },
  conversations: [],
  activeId: null,
};

let pendingAttachments = []; // queued for the next message: {type, page/image/text}
let streaming = false;
let currentAbort = null;
let streamContentEl = null;

const els = {};
function $(id) { return document.getElementById(id); }

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheEls();
  bindEvents();
  await loadState();
  render();
  await consumePendingContext();
}

function cacheEls() {
  [
    "convToggle", "brand", "newChatBtn", "newChatBtn2", "addPageBtn",
    "screenshotBtn", "settingsBtn", "convDrawer", "convList", "tabPicker",
    "messages", "composer", "attachments", "input", "sendBtn", "toast",
  ].forEach((id) => (els[id] = $(id)));
}

function bindEvents() {
  els.convToggle.addEventListener("click", () => toggleDrawer());
  els.brand.addEventListener("click", () => toggleDrawer());
  els.newChatBtn.addEventListener("click", () => newConversation());
  els.newChatBtn2.addEventListener("click", () => newConversation());
  els.addPageBtn.addEventListener("click", () => openTabPicker());
  els.screenshotBtn.addEventListener("click", () => takeScreenshot());
  els.settingsBtn.addEventListener("click", () => browser.runtime.openOptionsPage());
  els.sendBtn.addEventListener("click", () => {
    if (streaming) stopStreaming();
    else onSend();
  });

  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!streaming) onSend();
    }
  });
  els.input.addEventListener("input", autoResizeInput);

  els.messages.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (a && a.href) {
      e.preventDefault();
      browser.tabs.create({ url: a.href }).catch(() => {});
    }
  });

  // Close floating panels when clicking elsewhere.
  document.addEventListener("click", (e) => {
    if (!els.convDrawer.contains(e.target) && e.target !== els.convToggle && e.target !== els.brand && !els.brand.contains(e.target)) {
      els.convDrawer.classList.remove("open");
    }
    if (!els.tabPicker.contains(e.target) && e.target !== els.addPageBtn) {
      els.tabPicker.classList.remove("open");
    }
  });

  // Live updates from the options page / background script.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.settings) {
      state.settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
    }
    if (changes.pendingContext && changes.pendingContext.newValue) {
      handlePendingContext(changes.pendingContext.newValue);
    }
  });
}

/* ============================== state =================================== */

async function loadState() {
  const data = await store.get(["settings", "conversations", "activeId", "pendingContext"]);
  state.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  state.conversations = Array.isArray(data.conversations) ? data.conversations : [];
  state.activeId = data.activeId || null;
  if (state.conversations.length && !state.conversations.some((c) => c.id === state.activeId)) {
    state.activeId = state.conversations[state.conversations.length - 1].id;
  }
  // A fresh page load means nothing is still streaming. Any assistant message
  // left with no content (and no error/stop flag) was interrupted when the
  // sidebar was closed. Mark it so it renders as "interrupted" rather than a
  // stuck typing indicator, and persist that so it never re-fires on reopen.
  let dirty = false;
  for (const c of state.conversations) {
    for (const m of c.messages || []) {
      if (m.role === "assistant" && !m.content && !m.error && !m.stopped) {
        m.stopped = true;
        dirty = true;
      }
    }
  }
  if (dirty) await saveState();
}

async function saveState() {
  await store.set({
    settings: state.settings,
    conversations: state.conversations,
    activeId: state.activeId,
  });
}

let saveTimer = null;
// Debounced save used during streaming so partial output survives a close.
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    await saveState();
  }, 400);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function activeConversation() {
  return state.conversations.find((c) => c.id === state.activeId) || null;
}

function newConversation() {
  const c = {
    id: uid(),
    title: "",
    titleSet: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
  state.conversations.push(c);
  state.activeId = c.id;
  saveState();
  render();
  els.input.focus();
  return c;
}

function selectConversation(id) {
  state.activeId = id;
  els.convDrawer.classList.remove("open");
  saveState();
  render();
}

function deleteConversation(id) {
  state.conversations = state.conversations.filter((c) => c.id !== id);
  if (state.activeId === id) {
    state.activeId = state.conversations.length ? state.conversations[state.conversations.length - 1].id : null;
  }
  saveState();
  render();
}

function toggleDrawer() {
  els.tabPicker.classList.remove("open");
  els.convDrawer.classList.toggle("open");
}

/* ============================ rendering ================================= */

function render() {
  renderConversations();
  renderMessages();
  renderComposer();
}

function renderConversations() {
  const list = els.convList;
  list.innerHTML = "";
  const sorted = [...state.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  if (!sorted.length) {
    list.innerHTML = '<div class="conv-empty">No conversations yet</div>';
    return;
  }
  sorted.forEach((c) => {
    const item = document.createElement("button");
    item.className = "conv-item" + (c.id === state.activeId ? " active" : "");
    item.title = c.title || "New chat";

    const title = document.createElement("span");
    title.className = "conv-title";
    title.textContent = c.title || "New chat";
    item.appendChild(title);

    const del = document.createElement("button");
    del.className = "conv-del";
    del.textContent = "✕";
    del.title = "Delete conversation";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteConversation(c.id);
    });
    item.appendChild(del);

    item.addEventListener("click", () => selectConversation(c.id));
    list.appendChild(item);
  });
}

function renderMessages() {
  const convo = activeConversation();
  els.messages.innerHTML = "";

  if (!state.settings.apiKey) {
    els.messages.appendChild(buildSetupBanner());
    return;
  }
  if (!convo || !convo.messages.length) {
    els.messages.appendChild(buildEmptyState());
    return;
  }
  for (const m of convo.messages) {
    els.messages.appendChild(buildMessageEl(m));
  }
  scrollToBottom();
}

function buildSetupBanner() {
  const wrap = document.createElement("div");
  wrap.className = "empty-state";
  const icon = document.createElement("div");
  icon.className = "big";
  icon.textContent = "✦";
  const h = document.createElement("h2");
  h.textContent = "Connect your AI";
  const p = document.createElement("p");
  p.textContent = "Add an API key to start chatting. You can use OpenAI, DeepSeek, Anthropic, or any OpenAI-compatible provider.";
  const btn = document.createElement("button");
  btn.textContent = "Open settings";
  btn.addEventListener("click", () => browser.runtime.openOptionsPage());
  wrap.append(icon, h, p, btn);
  return wrap;
}

function buildEmptyState() {
  const wrap = document.createElement("div");
  wrap.className = "empty-state";
  const icon = document.createElement("div");
  icon.className = "big";
  icon.textContent = "✦";
  const h = document.createElement("h2");
  h.textContent = "Hi, I'm Neo";
  const p = document.createElement("p");
  p.textContent = "Ask anything, add an open page with 📄, or screenshot this page with 📷.";
  wrap.append(icon, h, p);
  return wrap;
}

function buildMessageEl(m) {
  const msg = document.createElement("div");
  msg.className = "msg " + m.role;
  if (m.error) msg.classList.add("error");

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  // Page / selection / image attachments rendered above the text.
  if (m.attachments && m.attachments.length) {
    const list = document.createElement("div");
    list.className = "attach-list";
    for (const a of m.attachments) {
      if (a.type === "page") list.appendChild(buildPageCard(a.page));
      else if (a.type === "selection") list.appendChild(buildSelectionCard(a));
    }
    if (list.children.length) bubble.appendChild(list);
    for (const a of m.attachments) {
      if (a.type === "image") {
        const img = document.createElement("div");
        img.className = "attach-img";
        const el = document.createElement("img");
        el.src = a.dataUrl;
        el.alt = a.label || "Screenshot";
        img.appendChild(el);
        bubble.appendChild(img);
      }
    }
  }

  const content = document.createElement("div");
  content.className = "content";
  if (m.role === "assistant") {
    if (m.error) {
      const strong = document.createElement("strong");
      strong.textContent = "Error: ";
      content.append(strong, m.error || "");
    } else if (m.content) {
      setMarkdown(content, m.content);
    } else if (m.stopped) {
      content.innerHTML = "<em>(response interrupted)</em>";
    } else {
      content.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
    }
  } else {
    if (m.content) {
      content.textContent = m.content;
      content.style.whiteSpace = "pre-wrap";
    }
  }
  bubble.appendChild(content);
  msg.appendChild(bubble);
  return msg;
}

function buildPageCard(page) {
  const a = document.createElement("a");
  a.className = "attach-card";
  const isWeb = /^https?:\/\//i.test(page.url || "");
  if (isWeb) {
    a.href = page.url;
    a.title = page.url;
  }
  const favUrl = isWeb ? faviconFor(page.url) : "";
  if (favUrl) {
    const fav = document.createElement("img");
    fav.src = favUrl;
    a.appendChild(fav);
  } else {
    const ph = document.createElement("span");
    ph.className = "fav-placeholder";
    a.appendChild(ph);
  }
  const meta = document.createElement("div");
  meta.className = "meta";
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = page.title || page.url || "Page";
  const url = document.createElement("div");
  url.className = "url";
  url.textContent = page.url || "";
  meta.append(title, url);
  a.append(meta);
  return a;
}

function buildSelectionCard(a) {
  const div = document.createElement("div");
  div.className = "attach-card";
  const ico = document.createElement("span");
  ico.textContent = "✂️";
  const meta = document.createElement("div");
  meta.className = "meta";
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = a.page && a.page.title ? "Selection from " + a.page.title : "Selected text";
  const url = document.createElement("div");
  url.className = "url";
  url.textContent = (a.page && a.page.url) || "";
  meta.append(title, url);
  div.append(ico, meta);
  return div;
}

function faviconFor(url) {
  try {
    return "https://www.google.com/s2/favicons?sz=32&domain=" + encodeURIComponent(new URL(url).hostname);
  } catch (e) {
    return "";
  }
}

function renderComposer() {
  const wrap = els.attachments;
  wrap.innerHTML = "";
  if (!pendingAttachments.length) {
    wrap.style.display = "none";
    return;
  }
  wrap.style.display = "flex";
  pendingAttachments.forEach((a, i) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    if (a.type === "page") {
      const ico = document.createElement("span");
      ico.className = "chip-ico";
      ico.textContent = "📄";
      const label = document.createElement("span");
      label.className = "chip-label";
      label.textContent = (a.page && a.page.title) || "Page";
      chip.append(ico, label);
    } else if (a.type === "image") {
      const img = document.createElement("img");
      img.src = a.dataUrl;
      img.alt = "";
      const label = document.createElement("span");
      label.className = "chip-label";
      label.textContent = a.label || "Screenshot";
      chip.append(img, label);
    } else if (a.type === "selection") {
      const ico = document.createElement("span");
      ico.className = "chip-ico";
      ico.textContent = "✂️";
      const label = document.createElement("span");
      label.className = "chip-label";
      label.textContent = "Selection";
      chip.append(ico, label);
    }
    const rm = document.createElement("button");
    rm.className = "chip-remove";
    rm.textContent = "✕";
    rm.title = "Remove";
    rm.addEventListener("click", () => {
      pendingAttachments.splice(i, 1);
      renderComposer();
    });
    chip.appendChild(rm);
    wrap.appendChild(chip);
  });
}

function autoResizeInput() {
  els.input.style.height = "auto";
  els.input.style.height = Math.min(els.input.scrollHeight, 180) + "px";
}

function scrollToBottom() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

function showToast(text) {
  els.toast.textContent = text;
  els.toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.toast.classList.remove("show"), 2600);
}

/* ==================== adding pages & screenshots ========================= */

async function openTabPicker() {
  if (els.tabPicker.classList.contains("open")) {
    els.tabPicker.classList.remove("open");
    return;
  }
  els.convDrawer.classList.remove("open");
  let tabs = [];
  try {
    tabs = await browser.tabs.query({ lastFocusedWindow: true });
  } catch (e) {
    tabs = await browser.tabs.query({});
  }
  els.tabPicker.innerHTML = "";
  if (!tabs.length) {
    els.tabPicker.innerHTML = '<div class="empty">No tabs found</div>';
    els.tabPicker.classList.add("open");
    return;
  }
  tabs.forEach((t, i) => {
    const btn = document.createElement("button");
    btn.className = "tab-item" + (t.active ? " active" : "");
    btn.title = t.url || "";
    if (t.favIconUrl) {
      const img = document.createElement("img");
      img.src = t.favIconUrl;
      btn.appendChild(img);
    } else {
      const ph = document.createElement("span");
      ph.className = "fav-placeholder";
      btn.appendChild(ph);
    }
    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = t.title || t.url || "Untitled";
    btn.appendChild(title);
    btn.addEventListener("click", () => {
      els.tabPicker.classList.remove("open");
      addPageFromTab(t);
    });
    els.tabPicker.appendChild(btn);
  });
  els.tabPicker.classList.add("open");
}

async function addPageFromTab(tab) {
  let page = { title: tab.title || "", url: tab.url || "", description: "", text: "" };
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPage,
    });
    if (results && results[0] && results[0].result) {
      page = { ...page, ...results[0].result };
      page.title = page.title || tab.title || "";
      page.url = page.url || tab.url || "";
    }
  } catch (e) {
    // Restricted page: keep title/url only.
  }
  pendingAttachments.push({ type: "page", page });
  renderComposer();
  showToast("Added: " + (page.title || "page"));
}

async function takeScreenshot() {
  try {
    const tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs && tabs[0];
    if (!tab) throw new Error("no active tab");
    const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, {
      format: "jpeg",
      quality: 85,
    });
    pendingAttachments.push({ type: "image", dataUrl, label: "Screenshot" });
    renderComposer();
    showToast("Screenshot added");
  } catch (e) {
    showToast("Couldn't capture this page: " + e.message);
  }
}

// Self-contained function for browser.scripting.executeScript.
function extractPage() {
  const meta = document.querySelector('meta[name="description"]');
  const og = document.querySelector('meta[property="og:description"]');
  return {
    title: document.title,
    url: location.href,
    description:
      (meta && meta.getAttribute("content")) ||
      (og && og.getAttribute("content")) ||
      "",
    text: (document.body ? document.body.innerText : "").slice(0, 8000),
  };
}

/* ========================== context menus =============================== */

async function consumePendingContext() {
  const { pendingContext } = await store.get("pendingContext");
  await handlePendingContext(pendingContext || null);
}

async function handlePendingContext(pc) {
  if (!pc) return;
  await store.remove("pendingContext");
  if (pc.kind === "page") {
    pendingAttachments.push({ type: "page", page: pc.page });
  } else if (pc.kind === "selection") {
    pendingAttachments.push({ type: "selection", text: pc.text, page: pc.page });
  }
  if (!activeConversation()) newConversation();
  renderComposer();
  showToast(pc.kind === "page" ? "Page added — ask away." : "Selection added — press Send.");
}

/* ============================ sending =================================== */

function setStreamingUI(on) {
  streaming = on;
  els.sendBtn.classList.toggle("stop", on);
  els.sendBtn.textContent = on ? "◼" : "➤";
  els.sendBtn.title = on ? "Stop" : "Send";
  els.addPageBtn.disabled = on;
  els.screenshotBtn.disabled = on;
}

async function onSend() {
  if (streaming) return;
  if (!state.settings.apiKey) {
    showToast("Add an API key in Settings first");
    browser.runtime.openOptionsPage();
    return;
  }

  const text = els.input.value.trim();
  const attachments = pendingAttachments.slice();
  if (!text && !attachments.length) return;

  // Lock immediately (synchronously) so a fast double-Enter cannot double-send
  // during the async gap before setStreamingUI() runs.
  streaming = true;

  let convo = activeConversation();
  if (!convo) convo = newConversation();

  els.input.value = "";
  autoResizeInput();
  pendingAttachments = [];
  renderComposer();

  const userMsg = { id: uid(), role: "user", content: text, attachments, ts: Date.now() };
  convo.messages.push(userMsg);
  convo.updatedAt = Date.now();

  // Auto-title from the first user message.
  if (!convo.titleSet && convo.messages.filter((m) => m.role === "user").length === 1) {
    convo.title =
      text ||
      ((attachments[0] && attachments[0].page && attachments[0].page.title) || "New chat");
    convo.titleSet = true;
  }
  await saveState();

  // Assistant placeholder bubble.
  const asstMsg = { id: uid(), role: "assistant", content: "", ts: Date.now() };
  convo.messages.push(asstMsg);
  convo.updatedAt = Date.now();
  // Persist the placeholder right away so a close/reopen keeps the full
  // history (prompt + reply slot) even if the stream never finishes.
  await saveState();
  renderConversations();
  renderMessages();
  streamContentEl = els.messages.querySelector(".msg.assistant:last-child .content");

  setStreamingUI(true);
  currentAbort = new AbortController();

  try {
    const { url, headers, body } = buildApiRequest(state.settings, convo, true);
    const full = await doStreamRequest(url, headers, body, state.settings.provider, (delta) => {
      asstMsg.content += delta;
      if (streamContentEl) setMarkdown(streamContentEl, asstMsg.content);
      scrollToBottom();
      scheduleSave();
    }, currentAbort.signal);
    asstMsg.content = full;
  } catch (err) {
    if (err && err.name === "AbortError") {
      asstMsg.stopped = true;
    } else {
      asstMsg.error = err.message || "Request failed";
    }
    renderMessages();
  } finally {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    currentAbort = null;
    streamContentEl = null;
    setStreamingUI(false);
    asstMsg.updatedAt = Date.now();
    await saveState();
  }
}

function stopStreaming() {
  if (currentAbort) currentAbort.abort();
}

/* ======================== API request building =========================== */

function attachmentsOf(m, type) {
  return (m.attachments || []).filter((a) => a.type === type);
}

function buildContextText(m) {
  const lines = [];
  for (const p of attachmentsOf(m, "page")) {
    lines.push("[Webpage]\nTitle: " + (p.title || "") + "\nURL: " + (p.url || ""));
    if (p.description) lines.push("Description: " + p.description);
    if (p.text) lines.push("Page content:\n" + p.text);
  }
  for (const s of attachmentsOf(m, "selection")) {
    lines.push(
      "[Selected text" + (s.page && s.page.title ? " from " + s.page.title : "") + "]\n" + (s.text || ""),
    );
  }
  return lines.join("\n\n");
}

function parseDataUrl(dataUrl) {
  const m = String(dataUrl).match(/^data:([^;,]+);base64,([\s\S]*)$/);
  return m ? { mediaType: m[1], data: m[2] } : { mediaType: "image/png", data: String(dataUrl) };
}

function openaiContent(m) {
  const images = attachmentsOf(m, "image");
  const context = buildContextText(m);
  let text = m.content || "";
  if (context) text = (text ? text + "\n\n" : "") + context;
  if (!images.length) return text;
  const parts = [{ type: "text", text }];
  for (const img of images) {
    parts.push({ type: "image_url", image_url: { url: img.dataUrl } });
  }
  return parts;
}

function anthropicContent(m) {
  const parts = [];
  const context = buildContextText(m);
  let text = m.content || "";
  if (context) text = (text ? text + "\n\n" : "") + context;
  if (text) parts.push({ type: "text", text });
  for (const img of attachmentsOf(m, "image")) {
    const parsed = parseDataUrl(img.dataUrl);
    parts.push({
      type: "image",
      source: { type: "base64", media_type: parsed.mediaType, data: parsed.data },
    });
  }
  if (!parts.length) parts.push({ type: "text", text: "" });
  return parts;
}

function buildApiRequest(settings, convo, stream) {
  const provider = settings.provider === "anthropic" ? "anthropic" : "openai";

  if (provider === "anthropic") {
    const base = settings.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
    const messages = convo.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: anthropicContent(m) }));
    return {
      url: base + "/v1/messages",
      headers: {
        "content-type": "application/json",
        "x-api-key": settings.apiKey,
        "anthropic-version": "2023-06-01",
        // Required by Anthropic for requests that carry a browser Origin.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: Number(settings.maxTokens) || 4096,
        temperature: clamp(Number(settings.temperature) || 0.7, 0, 1),
        system: settings.systemPrompt || "",
        messages,
        stream,
      }),
    };
  }

  const base = settings.baseUrl.replace(/\/+$/, "");
  const messages = [];
  if (settings.systemPrompt) messages.push({ role: "system", content: settings.systemPrompt });
  for (const m of convo.messages) {
    if (m.role === "system") continue;
    messages.push({ role: m.role, content: openaiContent(m) });
  }
  return {
    url: base + "/chat/completions",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + settings.apiKey,
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: Number(settings.temperature) || 0.7,
      max_tokens: Number(settings.maxTokens) || 4096,
      stream,
      messages,
    }),
  };
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/* =========================== streaming ================================== */

async function doStreamRequest(url, headers, body, provider, onDelta, signal) {
  const resp = await fetch(url, { method: "POST", headers, body, signal });
  if (!resp.ok) {
    let detail = "";
    try { detail = await resp.text(); } catch (e) { /* ignore */ }
    throw new Error("HTTP " + resp.status + (detail ? ": " + summarizeError(detail) : ""));
  }
  const ct = (resp.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("text/event-stream")) {
    return await readSSE(resp, provider, onDelta);
  }
  const data = await resp.json();
  const text = extractTextFromJson(data, provider);
  if (text) onDelta(text);
  return text;
}

async function readSSE(resp, provider, onDelta) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
      const chunk = handleSSELine(line, provider);
      if (chunk) {
        full += chunk;
        onDelta(chunk);
      }
    }
  }
  return full;
}

function handleSSELine(line, provider) {
  if (!line) return "";
  if (provider === "anthropic") {
    if (!line.startsWith("data:")) return "";
    const raw = line.slice(5).trim();
    if (!raw) return "";
    let obj;
    try { obj = JSON.parse(raw); } catch (e) { return ""; }
    if (obj.type === "content_block_delta" && obj.delta && obj.delta.type === "text_delta") {
      return obj.delta.text || "";
    }
    if (obj.type === "error") {
      throw new Error((obj.error && obj.error.message) || "Stream error");
    }
    return "";
  }
  // OpenAI-compatible SSE
  if (!line.startsWith("data:")) return "";
  const raw = line.slice(5).trim();
  if (!raw || raw === "[DONE]") return "";
  let obj;
  try { obj = JSON.parse(raw); } catch (e) { return ""; }
  if (obj.error) throw new Error(obj.error.message || "Stream error");
  const delta = obj.choices && obj.choices[0] && obj.choices[0].delta;
  if (delta && typeof delta.content === "string" && delta.content) {
    return delta.content;
  }
  return "";
}

function extractTextFromJson(data, provider) {
  if (!data) return "";
  if (provider === "anthropic") {
    if (Array.isArray(data.content)) {
      return data.content
        .filter((b) => b.type === "text")
        .map((b) => b.text || "")
        .join("");
    }
    return "";
  }
  const c = data.choices && data.choices[0];
  return (c && c.message && c.message.content) || "";
}

function summarizeError(text) {
  try {
    const j = JSON.parse(text);
    if (j.error && j.error.message) return j.error.message;
    if (j.error && typeof j.error === "string") return j.error;
  } catch (e) { /* not JSON */ }
  return text.slice(0, 300);
}

/* ============================ markdown ================================== */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// Render sanitized markdown into `el` without assigning innerHTML. The
// markdown() output is already HTML-escaped, and DOMParser does not execute
// scripts, so this is safe and keeps the AMO linter clean.
function setMarkdown(el, src) {
  const doc = new DOMParser().parseFromString("<div>" + markdown(src) + "</div>", "text/html");
  const wrapper = doc.body.firstElementChild;
  el.textContent = "";
  if (!wrapper) return;
  while (wrapper.firstChild) el.appendChild(wrapper.firstChild);
}

function markdown(src) {
  if (!src) return "";
  const codeStore = [];
  const text = String(src).replace(/```([\w+-]*)\n([\s\S]*?)```/g, (m, lang, code) => {
    const i = codeStore.length;
    codeStore.push({ lang: (lang || "").trim(), code: code.replace(/\n$/, "") });
    return "\n@@CODE" + i + "@@\n";
  });

  const lines = text.split("\n");
  const out = [];
  let para = [];
  let listType = null;
  let listBuf = [];

  const flushPara = () => {
    if (para.length) { out.push("<p>" + inline(para.join(" ")) + "</p>"); para = []; }
  };
  const flushList = () => {
    if (listBuf.length) {
      out.push((listType === "ol" ? "<ol>" : "<ul>") + listBuf.join("") + (listType === "ol" ? "</ol>" : "</ul>"));
      listBuf = [];
      listType = null;
    }
  };

  for (const line of lines) {
    const t = line.trim();
    if (/^@@CODE\d+@@$/.test(t)) {
      flushPara(); flushList();
      out.push(renderCodeBlock(t, codeStore));
      continue;
    }
    if (/^-{3,}$/.test(t)) { flushPara(); flushList(); out.push("<hr>"); continue; }
    const heading = t.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara(); flushList();
      out.push("<h" + heading[1].length + ">" + inline(heading[2]) + "</h" + heading[1].length + ">");
      continue;
    }
    if (/^>\s?/.test(t)) {
      flushPara(); flushList();
      out.push("<blockquote>" + inline(t.replace(/^>\s?/, "")) + "</blockquote>");
      continue;
    }
    const ul = t.match(/^[-*+]\s+(.*)$/);
    const ol = t.match(/^\d+[.)]\s+(.*)$/);
    if (ul) {
      flushPara();
      if (listType !== "ul") { flushList(); listType = "ul"; }
      listBuf.push("<li>" + inline(ul[1]) + "</li>");
      continue;
    }
    if (ol) {
      flushPara();
      if (listType !== "ol") { flushList(); listType = "ol"; }
      listBuf.push("<li>" + inline(ol[1]) + "</li>");
      continue;
    }
    if (t === "") { flushPara(); flushList(); continue; }
    flushList();
    para.push(t);
  }
  flushPara();
  flushList();
  return out.join("");
}

function renderCodeBlock(token, store) {
  const m = token.match(/^@@CODE(\d+)@@$/);
  const b = store[Number(m[1])];
  const langLabel = b.lang ? '<span class="code-lang">' + escapeHtml(b.lang) + "</span>" : "";
  return '<pre class="code-block">' + langLabel + "<code>" + escapeHtml(b.code) + "</code></pre>";
}

function inline(s) {
  let h = escapeHtml(s);
  h = h.replace(/`([^`\n]+)`/g, (m, c) => "<code>" + c + "</code>");
  h = h.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  h = h.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  h = h.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, txt, url) =>
    '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + txt + "</a>");
  return h;
}
