'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const LIB_PATH = require.resolve('../fit-to-page.js');
const ROOT = path.join(__dirname, '..');

const DEFAULT_HTML = '<!DOCTYPE html><html><head></head><body><div class="content"></div></body></html>';

/**
 * Load a pristine copy of the library against a fresh jsdom document.
 * The library is a singleton holding its own config, so every test needs a
 * new module instance rather than a shared one.
 *
 * jsdom leaves a freshly constructed document at readyState 'loading', which
 * would make init() defer every measurement. Default to 'complete' to model
 * the normal case of a script tag running against parsed markup.
 */
function setup(html = DEFAULT_HTML, readyState = 'complete') {
    const dom = new JSDOM(html);

    Object.defineProperty(dom.window.document, 'readyState', {
        value: readyState,
        configurable: true
    });

    global.window = dom.window;
    global.document = dom.window.document;

    delete require.cache[LIB_PATH];
    const FitToPage = require(LIB_PATH);

    return { FitToPage, window: dom.window, document: dom.window.document };
}

/**
 * jsdom does not lay out, so scrollWidth/scrollHeight always read 0.
 * Stub them to simulate rendered content.
 */
function sizeElement(element, width, height) {
    Object.defineProperty(element, 'scrollWidth', { value: width, configurable: true });
    Object.defineProperty(element, 'scrollHeight', { value: height, configurable: true });
}

/**
 * mm values are raw floats that only get rounded on the way into CSS,
 * so compare them with a tolerance rather than exactly.
 */
function assertCloseTo(actual, expected, message) {
    assert.ok(
        Math.abs(actual - expected) < 1e-6,
        message || `expected ${actual} to be within 1e-6 of ${expected}`
    );
}

function styleFor(document) {
    return document.getElementById('fit-to-page-styles');
}

function cssFor(document) {
    const style = styleFor(document);
    return style ? style.textContent : '';
}

test.afterEach(() => {
    delete global.window;
    delete global.document;
});

test('pxToMm converts using the configured dpi', () => {
    const { FitToPage, document } = setup();
    sizeElement(document.querySelector('.content'), 100, 100);

    FitToPage.init({ selector: '.content' });
    // 1 CSS inch = 96px = 25.4mm
    assertCloseTo(FitToPage.pxToMm(96), 25.4);
    assert.equal(FitToPage.pxToMm(0), 0);

    FitToPage.init({ selector: '.content', dpi: 192 });
    assertCloseTo(FitToPage.pxToMm(96), 12.7);
});

test('page size is content plus both margins plus padding', () => {
    const { FitToPage, document } = setup();
    sizeElement(document.querySelector('.content'), 1200, 800);

    let info;
    FitToPage.init({
        selector: '.content',
        margin: 10,
        padding: 5,
        onReady: (result) => { info = result; }
    });

    // 1200px -> 317.5mm, + (10 * 2) + 5
    assert.equal(info.width.px, 1200);
    assertCloseTo(info.width.mm, 342.5);
    // 800px -> 211.666...mm, + 25
    assert.equal(info.height.px, 800);
    assertCloseTo(info.height.mm, 236.666666);
});

test('auto orientation keeps wide content landscape', () => {
    const { FitToPage, document } = setup();
    sizeElement(document.querySelector('.content'), 1200, 800);

    FitToPage.init({ selector: '.content', orientation: 'auto' });

    assert.match(cssFor(document), /size:\s*342\.5mm\s+236\.7mm;/);
});

test('auto orientation keeps tall content portrait', () => {
    const { FitToPage, document } = setup();
    sizeElement(document.querySelector('.content'), 800, 1200);

    FitToPage.init({ selector: '.content', orientation: 'auto' });

    assert.match(cssFor(document), /size:\s*236\.7mm\s+342\.5mm;/);
});

test('portrait orientation swaps a wide measurement', () => {
    const { FitToPage, document } = setup();
    sizeElement(document.querySelector('.content'), 1200, 800);

    FitToPage.init({ selector: '.content', orientation: 'portrait' });

    // forced portrait: short edge becomes the width
    assert.match(cssFor(document), /size:\s*236\.7mm\s+342\.5mm;/);
});

test('landscape orientation swaps a tall measurement', () => {
    const { FitToPage, document } = setup();
    sizeElement(document.querySelector('.content'), 800, 1200);

    FitToPage.init({ selector: '.content', orientation: 'landscape' });

    // forced landscape: long edge becomes the width
    assert.match(cssFor(document), /size:\s*342\.5mm\s+236\.7mm;/);
});

test('injects a single identified style element carrying @page size and margin', () => {
    const { FitToPage, document } = setup();
    sizeElement(document.querySelector('.content'), 1200, 800);

    FitToPage.init({ selector: '.content', margin: 15 });

    const style = styleFor(document);
    assert.ok(style, 'expected #fit-to-page-styles to exist');
    assert.equal(style.tagName, 'STYLE');
    assert.equal(style.parentNode, document.head);
    assert.match(style.textContent, /@page\s*{/);
    assert.match(style.textContent, /margin:\s*15mm;/);
});

test('preventPageBreaks toggles the break-avoidance rules', () => {
    const on = setup();
    sizeElement(on.document.querySelector('.content'), 1200, 800);
    on.FitToPage.init({ selector: '.content', preventPageBreaks: true });
    assert.match(cssFor(on.document), /page-break-inside:\s*avoid\s*!important/);
    assert.match(cssFor(on.document), /break-inside:\s*avoid\s*!important/);

    const off = setup();
    sizeElement(off.document.querySelector('.content'), 1200, 800);
    off.FitToPage.init({ selector: '.content', preventPageBreaks: false });
    assert.doesNotMatch(cssFor(off.document), /page-break-inside/);
    // the print media block itself survives
    assert.match(cssFor(off.document), /@media print/);
});

test('remeasure replaces the style element instead of stacking duplicates', () => {
    const { FitToPage, document } = setup();
    const content = document.querySelector('.content');
    sizeElement(content, 1200, 800);

    FitToPage.init({ selector: '.content' });
    FitToPage.remeasure();
    FitToPage.remeasure();

    assert.equal(document.querySelectorAll('#fit-to-page-styles').length, 1);
    assert.equal(document.head.querySelectorAll('style').length, 1);
});

test('remeasure picks up new content dimensions', () => {
    const { FitToPage, document } = setup();
    const content = document.querySelector('.content');
    sizeElement(content, 1200, 800);

    FitToPage.init({ selector: '.content' });
    assert.match(cssFor(document), /size:\s*342\.5mm\s+236\.7mm;/);

    // content grew, e.g. a "load more" click
    sizeElement(content, 1200, 2400);
    FitToPage.remeasure();

    // 2400px -> 635mm, + 25 -> 660mm, now the long edge
    assert.match(cssFor(document), /size:\s*342\.5mm\s+660\.0mm;/);
});

test('onReady receives measurements and the resolved page size', () => {
    const { FitToPage, document } = setup();
    sizeElement(document.querySelector('.content'), 1200, 800);

    const calls = [];
    FitToPage.init({
        selector: '.content',
        orientation: 'portrait',
        onReady: (info) => calls.push(info)
    });

    assert.equal(calls.length, 1);
    const [info] = calls;
    assert.deepEqual(Object.keys(info).sort(), ['height', 'pageSize', 'width']);
    assert.equal(info.width.px, 1200);
    assert.equal(info.height.px, 800);
    // forced portrait, so pageSize is the swap of the raw measurement
    assert.ok(info.pageSize.width < info.pageSize.height);
    assertCloseTo(info.pageSize.height, 342.5);
});

test('debug box is opt-in and reports both content and page dimensions', () => {
    const quiet = setup();
    sizeElement(quiet.document.querySelector('.content'), 1200, 800);
    quiet.FitToPage.init({ selector: '.content' });
    assert.equal(quiet.document.getElementById('fit-to-page-debug-box'), null);

    const loud = setup();
    sizeElement(loud.document.querySelector('.content'), 1200, 800);
    loud.FitToPage.init({ selector: '.content', debug: true });

    const box = loud.document.getElementById('fit-to-page-debug-box');
    assert.ok(box, 'expected the debug box to be rendered');
    assert.equal(box.className, 'fit-to-page-debug');
    assert.match(box.innerHTML, /1200px/);
    assert.match(box.innerHTML, /800px/);
    assert.match(box.innerHTML, /342\.5mm/);
    // and it must never reach the printed output
    assert.match(cssFor(loud.document), /\.fit-to-page-debug\s*{\s*display:\s*none\s*!important/);
});

test('debug box is not duplicated across remeasures', () => {
    const { FitToPage, document } = setup();
    sizeElement(document.querySelector('.content'), 1200, 800);

    FitToPage.init({ selector: '.content', debug: true });
    FitToPage.remeasure();
    FitToPage.remeasure();

    assert.equal(document.querySelectorAll('#fit-to-page-debug-box').length, 1);
});

test('a missing selector reports an error without injecting anything', () => {
    const { FitToPage, document } = setup();

    const original = console.error;
    const errors = [];
    console.error = (msg) => errors.push(msg);

    try {
        FitToPage.init({ selector: '.does-not-exist' });
    } finally {
        console.error = original;
    }

    assert.equal(errors.length, 1);
    assert.match(errors[0], /\.does-not-exist/);
    assert.equal(styleFor(document), null);
});

test('measurement is deferred until DOMContentLoaded while the document is loading', () => {
    const { FitToPage, window, document } = setup(DEFAULT_HTML, 'loading');
    sizeElement(document.querySelector('.content'), 1200, 800);

    FitToPage.init({ selector: '.content' });
    assert.equal(styleFor(document), null, 'must not measure before the DOM is ready');

    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    assert.ok(styleFor(document), 'expected measurement once the DOM is ready');
});

test('the library is exposed globally and as a module export', () => {
    const { FitToPage, window } = setup();

    assert.equal(window.FitToPage, FitToPage);
    assert.equal(typeof FitToPage.init, 'function');
    assert.equal(typeof FitToPage.remeasure, 'function');
});

test('the version is identical in every place it is published', () => {
    const { FitToPage } = setup();

    const source = fs.readFileSync(path.join(ROOT, 'fit-to-page.js'), 'utf8');
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

    const jsdocVersion = source.match(/@version\s+(\d+\.\d+\.\d+)/);
    const cdnVersion = readme.match(/fit-to-page@(\d+\.\d+\.\d+)/);

    assert.ok(jsdocVersion, 'expected an @version tag in the source header');
    assert.ok(cdnVersion, 'expected a pinned CDN url in the README');

    assert.equal(FitToPage.version, pkg.version, 'FitToPage.version is out of sync with package.json');
    assert.equal(jsdocVersion[1], pkg.version, 'the @version header is out of sync with package.json');
    assert.equal(cdnVersion[1], pkg.version, 'the README CDN url is out of sync with package.json');
});
