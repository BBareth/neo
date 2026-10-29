# Privacy policy — Neo AI Sidebar

_Last updated: 2026-10-29_

Neo is a Firefox extension that lets you chat with an AI provider **you**
choose, using **your own** API key. It has no server of its own, no account,
no analytics, and no telemetry.

## What is stored, and where

Everything is kept in Firefox's extension storage (`browser.storage.local`) on
your computer:

- your settings: provider, base URL, API key, model, system prompt,
  temperature, max tokens and open mode;
- your conversations, including any page text, selections and screenshots you
  attached to them.

Removing the extension deletes this data. Deleting a conversation in the
sidebar deletes it from storage.

## What is sent, and to whom

Data leaves your computer only when you send a message (or press **Test
connection**). It then goes directly from Firefox to the **base URL you
configured**, for example `api.openai.com`, `api.anthropic.com`,
`api.deepseek.com`, `openrouter.ai`, or a local server such as Ollama. That
request contains:

- your API key (as an `Authorization` or `x-api-key` header);
- the conversation's messages and the system prompt;
- anything you attached to it: the title, URL, description and up to 8,000
  characters of text of a page you added, text you selected, and screenshots
  of the visible part of a tab.

Neo never reads a page, takes a screenshot, or sends anything on its own.
Each of these happens only when you click 📄, 📷, a right-click **Neo** menu
item, or **Send**.

What the provider does with that data is governed by **their** privacy policy
and terms, not this one. Read them before you send personal or sensitive
information.

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Save settings and conversations locally. |
| `tabs` | List your open tabs in the 📄 picker and find the active tab for screenshots. |
| `scripting`, `activeTab`, `<all_urls>` | Read the title, description and text of a page you choose to add, and capture a screenshot of the visible tab. Also lets the extension reach whatever AI endpoint you configure. |
| `menus` | The right-click "Add this page to Neo AI" and "Ask Neo AI about the selection" items. |

## Contact

Questions or concerns: open an issue at
<https://github.com/BBareth/neo/issues>.
