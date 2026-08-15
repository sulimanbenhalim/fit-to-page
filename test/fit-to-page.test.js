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
 * a script running against a fully loaded page.
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

function captureConsole(fn) {
    const original = { warn: console.warn, error: console.error };
    const warnings = [];
    const errors = [];

    console.warn = (msg) => warnings.push(msg);
    console.error = (msg) => errors.push(msg);

    let result;
    try {
        result = fn();
    } finally {
        console.warn = original.warn;
        console.error = original.error;
    }

    return { warnings, errors, result };
}

function styleFor(document) {
    return document.getElementById('fit-to-page-styles');
}

function cssFor(document) {
    const style = styleFor(document);
    return style ? style.textContent : '';
}

/** The page size the browser was actually told to use. */
function declaredMm(document) {
    const match = cssFor(document).match(/size:\s*([\d.]+)mm\s+([\d.]+)mm;/);
    return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
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

test('a forced portrait page still contains wide content', () => {
    const { FitToPage, document } = setup();
    sizeElement(document.querySelector('.content'), 1200, 800);

    FitToPage.init({ selector: '.content', orientation: 'portrait' });

    // The content needs 342.5mm of width. Swapping the two dimensions would
    // declare a 236.7mm-wide page and push 105.8mm of content off the sheet,
    // so the short side grows to meet the long one instead.
    assert.match(cssFor(document), /size:\s*342\.5mm\s+342\.5mm;/);
});

test('a forced landscape page still contains tall content', () => {
    const { FitToPage, document } = setup();
    sizeElement(document.querySelector('.content'), 800, 1200);

    FitToPage.init({ selector: '.content', orientation: 'landscape' });

    assert.match(cssFor(document), /size:\s*342\.5mm\s+342\.5mm;/);
});

test('the declared page contains the content at every orientation', () => {
    const sizes = [[1200, 800], [800, 1200], [1000, 1000], [1920, 300], [300, 4000]];

    for (const orientation of ['auto', 'portrait', 'landscape']) {
        for (const [px, py] of sizes) {
            const { FitToPage, document } = setup();
            sizeElement(document.querySelector('.content'), px, py);

            let info;
            FitToPage.init({
                selector: '.content',
                orientation,
                onReady: (result) => { info = result; }
            });

            const declared = declaredMm(document);
            const label = `${orientation} ${px}x${py}`;

            assert.ok(declared.width >= info.width.mm, `${label}: page narrower than content`);
            assert.ok(declared.height >= info.height.mm, `${label}: page shorter than content`);

            if (orientation === 'landscape') {
                assert.ok(declared.width >= declared.height, `${label}: not landscape`);
            }
            if (orientation === 'portrait') {
                assert.ok(declared.height >= declared.width, `${label}: not portrait`);
            }
        }
    }
});

test('page dimensions round up, never down', () => {
    const { FitToPage, document } = setup();
    // 1202px is 318.029mm; rounding to nearest declares 318.0mm and clips it
    sizeElement(document.querySelector('.content'), 1202, 800);

    FitToPage.init({ selector: '.content', margin: 0, padding: 0 });

    assert.match(cssFor(document), /size:\s*318\.1mm/);
    assert.ok(declaredMm(document).width >= 1202 * 25.4 / 96);
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

test('remeasure picks up new content dimensions and returns them', () => {
    const { FitToPage, document } = setup();
    const content = document.querySelector('.content');
    sizeElement(content, 1200, 800);

    FitToPage.init({ selector: '.content' });
    assert.match(cssFor(document), /size:\s*342\.5mm\s+236\.7mm;/);

    // content grew, e.g. a "load more" click
    sizeElement(content, 1200, 2400);
    const info = FitToPage.remeasure();

    // 2400px -> 635mm, + 25 -> 660mm, now the long edge
    assert.match(cssFor(document), /size:\s*342\.5mm\s+660\.0mm;/);
    assert.equal(info.height.px, 2400);
    assertCloseTo(info.pageSize.height, 660);
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
    // forced portrait on wide content grows the height to match the width
    assert.ok(info.pageSize.height >= info.pageSize.width);
    assertCloseTo(info.pageSize.width, 342.5);
    assertCloseTo(info.pageSize.height, 342.5);
});

test('an explicit undefined option falls back to the default', () => {
    const { FitToPage, document } = setup();
    sizeElement(document.querySelector('.content'), 1200, 800);

    // Object.assign would copy undefined straight over the default and the
    // page size would come out as NaNmm, voiding the whole declaration.
    const { warnings } = captureConsole(() =>
        FitToPage.init({ selector: '.content', dpi: undefined, margin: undefined }));

    assert.equal(FitToPage.config.dpi, 96);
    assert.equal(FitToPage.config.margin, 10);
    assert.equal(warnings.length, 0, 'an omitted option is not a mistake worth warning about');
    assert.doesNotMatch(cssFor(document), /NaN/);
    assert.match(cssFor(document), /size:\s*342\.5mm\s+236\.7mm;/);
});

test('an unusable dpi warns and falls back instead of voiding the @page rule', () => {
    for (const dpi of [0, -96, 'abc', Infinity, null]) {
        const { FitToPage, document } = setup();
        sizeElement(document.querySelector('.content'), 1200, 800);

        const { warnings } = captureConsole(() =>
            FitToPage.init({ selector: '.content', dpi }));

        assert.equal(FitToPage.config.dpi, 96, `dpi ${dpi} should fall back to 96`);
        assert.equal(warnings.length, 1, `dpi ${dpi} should warn once`);
        assert.doesNotMatch(cssFor(document), /NaN|Infinity/);
    }
});

test('a negative margin or padding warns and falls back', () => {
    const { FitToPage, document } = setup();
    sizeElement(document.querySelector('.content'), 1200, 800);

    const { warnings } = captureConsole(() =>
        FitToPage.init({ selector: '.content', margin: -5, padding: NaN }));

    assert.equal(FitToPage.config.margin, 10);
    assert.equal(FitToPage.config.padding, 5);
    assert.equal(warnings.length, 2);
    assert.doesNotMatch(cssFor(document), /NaN/);
});

test('an unknown orientation warns and falls back to auto', () => {
    const { FitToPage, document } = setup();
    sizeElement(document.querySelector('.content'), 1200, 800);

    const { warnings } = captureConsole(() =>
        FitToPage.init({ selector: '.content', orientation: 'Portrait' }));

    assert.equal(FitToPage.config.orientation, 'auto');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /orientation/);
    assert.match(cssFor(document), /size:\s*342\.5mm\s+236\.7mm;/);
});

test('a page past the PDF size limit warns that it will not be one page', () => {
    const { FitToPage, document } = setup();
    // 20000px is 5291.7mm, past PDF's 14400 unit (5080mm) architectural limit
    sizeElement(document.querySelector('.content'), 1200, 20000);

    const { warnings } = captureConsole(() => FitToPage.init({ selector: '.content' }));

    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /5080mm/);
    // the rule is still emitted, since a too-large page beats no page at all
    assert.ok(styleFor(document));
});

test('empty or hidden content warns rather than declaring a nonsense page', () => {
    const { FitToPage, document } = setup();
    sizeElement(document.querySelector('.content'), 0, 0);

    const { warnings } = captureConsole(() => FitToPage.init({ selector: '.content' }));

    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /0x0px/);
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
    // the box must quote the same page size that went into the @page rule
    assert.match(box.innerHTML, /342\.5mm × 236\.7mm/);
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

    const { errors, result } = captureConsole(() =>
        FitToPage.init({ selector: '.does-not-exist' }));

    assert.equal(errors.length, 1);
    assert.match(errors[0], /\.does-not-exist/);
    assert.equal(styleFor(document), null);
    assert.equal(result, undefined);
    assert.equal(captureConsole(() => FitToPage.remeasure()).result, null);
});

test('measurement waits for load rather than DOMContentLoaded', () => {
    const { FitToPage, window, document } = setup(DEFAULT_HTML, 'loading');
    const content = document.querySelector('.content');
    sizeElement(content, 1200, 800);

    FitToPage.init({ selector: '.content' });
    assert.equal(styleFor(document), null, 'must not measure while the document is loading');

    // Images are still in flight here, so measuring now would lock in a page
    // 105.8mm shorter than the content ends up being.
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    assert.equal(styleFor(document), null, 'must not measure at DOMContentLoaded');

    sizeElement(content, 1200, 1200);
    window.dispatchEvent(new window.Event('load'));

    assert.match(cssFor(document), /size:\s*342\.5mm\s+342\.5mm;/);
});

test('a document at interactive still defers to load', () => {
    const { FitToPage, window, document } = setup(DEFAULT_HTML, 'interactive');
    sizeElement(document.querySelector('.content'), 1200, 800);

    FitToPage.init({ selector: '.content' });
    assert.equal(styleFor(document), null, 'subresources are still loading at interactive');

    window.dispatchEvent(new window.Event('load'));
    assert.ok(styleFor(document));
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
