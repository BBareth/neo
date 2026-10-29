// Settings for `npx web-ext run | lint | build`. Keeps docs and tooling out of
// the package submitted to addons.mozilla.org.
export default {
  ignoreFiles: [
    "docs",
    "tools",
    "*.md",
    "LICENSE",
    "web-ext-config.mjs",
    "*.xpi",
  ],
  build: {
    overwriteDest: true,
  },
};
