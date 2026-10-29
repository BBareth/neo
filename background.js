"use strict";

// ---------------------------------------------------------------------------
// Neo AI Sidebar — background script
//   * Two open modes, chosen in settings:
//       - "sidebar": the toolbar button / keyboard toggles the Firefox sidebar.
//       - "popup":   the toolbar button / keyboard opens an action popup that
//                    closes by itself when it loses focus (like Bitwarden).
//     The keyboard shortcut uses `_execute_action`, which acts like a click on
//     the toolbar button, so the same shortcut works in both modes.
//   * Context-menu items hand context to the UI through browser.storage.local.
// ---------------------------------------------------------------------------

// Toolbar button: this only fires when NO popup is set (sidebar mode).
browser.action.onClicked.addListener(() => {
  browser.sidebarAction.toggle().catch(() => {});
});

// Apply the chosen open mode by turning the action popup on or off.
async function applyOpenMode(mode) {
  if (mode === "popup") {
    await browser.action.setPopup({ popup: "popup/popup.html" });
  } else {
    await browser.action.setPopup({ popup: "" });
  }
}

async function syncOpenMode() {
  const { settings } = await browser.storage.local.get("settings");
  const mode = settings && settings.openMode === "popup" ? "popup" : "sidebar";
  await applyOpenMode(mode);
}

// Register context menus once and apply the chosen open mode.
browser.runtime.onInstalled.addListener(() => {
  syncOpenMode();
  browser.menus.create({
    id: "neo-add-page",
    title: "Add this page to Neo AI",
    contexts: ["page", "tab"],
  });
  browser.menus.create({
    id: "neo-add-selection",
    title: "Ask Neo AI about the selection",
    contexts: ["selection"],
  });
});

// Re-apply on browser start and whenever the setting changes.
browser.runtime.onStartup.addListener(() => {
  syncOpenMode();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) {
    const mode =
      changes.settings.newValue && changes.settings.newValue.openMode === "popup"
        ? "popup"
        : "sidebar";
    applyOpenMode(mode);
  }
});

// Send the payload to the sidebar via storage (robust against load timing),
// then make sure the sidebar is open.
async function queueContext(payload) {
  await browser.storage.local.set({
    pendingContext: { ...payload, ts: Date.now() },
  });
  await browser.sidebarAction.open();
}

browser.menus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === "neo-add-page" && tab) {
      const page = await getPageInfo(tab);
      await queueContext({ kind: "page", page });
    } else if (info.menuItemId === "neo-add-selection") {
      await queueContext({
        kind: "selection",
        text: info.selectionText || "",
        page: {
          title: (tab && tab.title) || "",
          url: (tab && tab.url) || "",
        },
      });
    }
  } catch (err) {
    console.error("Neo context menu error:", err);
  }
});

// Extract title/url + a text excerpt from a tab. Restricted pages
// (about:, moz-extension:, addons.mozilla.org without permission, etc.)
// will throw on the script injection — fall back to title/url only.
async function getPageInfo(tab) {
  let description = "";
  let text = "";
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageText,
    });
    if (results && results[0] && results[0].result) {
      description = results[0].result.description || "";
      text = results[0].result.text || "";
    }
  } catch (err) {
    // Fall through with title/url only.
  }
  return {
    title: tab.title || "",
    url: tab.url || "",
    description,
    text,
  };
}

// Must be a self-contained function for browser.scripting.executeScript.
function extractPageText() {
  const meta = document.querySelector('meta[name="description"]');
  const og = document.querySelector('meta[property="og:description"]');
  return {
    description:
      (meta && meta.getAttribute("content")) ||
      (og && og.getAttribute("content")) ||
      "",
    text: (document.body ? document.body.innerText : "").slice(0, 8000),
  };
}
