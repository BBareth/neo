# Security

## Trust model

- **Your API key lives in Firefox's extension storage, unencrypted.** Anyone
  with access to your Firefox profile can read it. Use a key with a spending
  limit, and revoke it at the provider if your profile may be compromised.
- **Neo talks directly to the base URL you configure.** It does not validate
  that URL beyond making the request, so only point it at a provider (or local
  server) you trust. A malicious endpoint receives your key and everything you
  send it.
- **Pages you add are sent to the AI as text.** A page can contain text written
  to manipulate the model (prompt injection). Neo never acts on the model's
  output — it only displays it — but treat answers about untrusted pages with
  the same caution as the pages themselves.
- **Model output is rendered as sanitized Markdown.** Neo HTML-escapes the
  whole response first, then turns a small Markdown subset into elements.
  Links are limited to `http(s)` and open in a new tab. Raw HTML and scripts
  from a response are never rendered or run.

## Reporting a vulnerability

Please report security issues privately through
[GitHub's private vulnerability reporting](https://github.com/BBareth/neo/security/advisories/new)
rather than a public issue. Include the Firefox version, the extension version
and steps to reproduce. I aim to reply within a week.
