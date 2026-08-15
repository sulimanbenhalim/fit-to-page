# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

FitToPage.js is a zero-dependency, single-file vanilla JS library. It measures rendered DOM content and injects a `@page { size: ... }` rule so the browser's native print (Cmd+P → Save as PDF) fits everything on one page. It is *not* a PDF generator — it never rasterizes; it only manipulates print CSS.

## Commands

```bash
npm ci               # clean install from the lockfile (what CI runs)
npm test             # node:test + jsdom suite in test/
npm run build        # terser fit-to-page.js -> fit-to-page.min.js
npm run check:build  # rebuild, then fail if fit-to-page.min.js drifted
```

Run a single test by name: `node --test --test-name-pattern "orientation" "test/*.test.js"`.

There is no linter. Both `npm test` and `npm run check:build` run in CI (`.github/workflows/ci.yml`) on Node 22 and 24.

The suite covers the measurement logic, not real layout. **Anything visual still needs a manual check**: open `demo.html` in Chrome, read the debug box, then print-preview and confirm a single page. `demo.html` loads the unminified `fit-to-page.js`, so changes are testable without building.

## Architecture

Everything lives in `fit-to-page.js` — an IIFE exposing a **singleton object** as `window.FitToPage`, with a `module.exports` fallback. Because config is stored on the singleton (`FitToPage.config`), only one configuration can be active per page; calling `init()` twice replaces the previous config.

The measurement pipeline in `measure()`:

1. `element.scrollWidth/scrollHeight` of `config.selector` (defaults to `body`)
2. `pxToMm()` — `px * 25.4 / config.dpi`, dpi configurable because browsers report CSS pixels, not physical ones
3. add `margin * 2 + padding` to each dimension
4. `fitPage()` applies the orientation constraint
5. `injectCSS()` writes `@page { size: <w>mm <h>mm; margin: <margin>mm }`, formatting via `toMm()`

Note step 3 and step 5 are deliberate together: the computed page size already includes the margin box, and `@page margin` then reserves it inside that page.

**The invariant the whole library rests on: the declared page is never smaller than the content.** Two places enforce it and both are easy to break by accident:

- `fitPage()` satisfies a forced orientation by *growing the short side*, never by swapping width and height. Swapping is the intuitive implementation and it is wrong — forcing `portrait` on landscape content would declare a page narrower than the content and push the overflow onto a second sheet. A forced orientation on content of the opposite aspect correctly yields a square.
- `toMm()` rounds **up** to the next 0.1mm. `toFixed(1)` rounds to nearest, which can declare a page up to 0.05mm short — invisible until someone sets `padding: 0` and loses the slack that was hiding it.

`init()` waits for `load`, not `DOMContentLoaded`: images and stylesheets are still in flight at `DOMContentLoaded`, so measuring there locks in a page too short for the finished layout. `readyState === 'complete'` is the only state that measures synchronously. Web fonts can still swap after `load` — that one is documented in the README as a `remeasure()` recipe rather than handled here, to keep `init()` synchronous.

`resolveConfig()` exists because `Object.assign` copies an explicit `undefined` over a default, so `init({ dpi: someUnsetVar })` would put `NaN` in the `@page` size and void the entire declaration. It also rejects non-finite/negative numerics and unknown orientations, warning rather than emitting unusable CSS.

`injectCSS()` and `showDebugInfo()` both remove their existing element (`#fit-to-page-styles`, `#fit-to-page-debug-box`) before re-creating it, which is what makes `remeasure()` safe to call repeatedly on dynamic content.

`preventPageBreaks: true` emits a `* { page-break-inside: avoid !important }` rule inside `@media print`. This is a blunt instrument by design — it is the safety net for content that would otherwise split despite the oversized page.

## Writing tests

`test/fit-to-page.test.js` uses `node:test` with jsdom. Two things about that environment are load-bearing, and tests silently pass-by-accident without them:

- **jsdom has no layout engine**, so `scrollWidth`/`scrollHeight` always read `0`. The `sizeElement()` helper stubs them with `Object.defineProperty`. Real layout is the browser's job and is out of scope here.
- **jsdom leaves a new document at `readyState: 'loading'`**, which makes `init()` defer to `DOMContentLoaded` and measure nothing. `setup()` forces `'complete'` by default; pass `'loading'` explicitly to test the deferral path.

The library is a singleton, so `setup()` clears the require cache to get a fresh instance per test. Assert mm values with `assertCloseTo` — they're raw floats only rounded on the way into CSS (`96 * 25.4 / 96` is `25.399999999999995`).

The suite is mutation-checked: breaking the orientation comparison, the margin doubling, the unit constant, the remove-then-recreate logic, or the version sync each turn it red.

## Conventions

- **Rebuild and commit `fit-to-page.min.js` whenever `fit-to-page.js` changes.** Both files are tracked in git and listed in `package.json` `files`, so a stale minified build ships to npm and jsDelivr. CI enforces this via `npm run check:build`.
- The version string is duplicated in four places — the JSDoc header and `version:` property in `fit-to-page.js`, `package.json`, and the pinned CDN URL in `README.md`. Update all four on a bump; a test fails if they diverge.
- `package-lock.json` is committed, and CI uses `npm ci`. This keeps `terser` pinned, without which the build-drift check would go red whenever terser publishes a release that changes its output.
- No build tooling beyond terser; keep the source ES5-compatible-ish (it currently uses arrow functions and template literals, so ES6 is fine, but avoid anything needing a transpiler).
- `prepublishOnly` runs the build and the tests, so `npm publish` can't ship a stale or failing build.

## Safari

Safari is explicitly unsupported and documented as such in the README. It ignores custom `@page { size }` and computes page breaks before print CSS/JS applies. Do not attempt client-side workarounds — the recommended answer for users is server-side headless Chrome.
