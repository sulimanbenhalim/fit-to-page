# FitToPage.js

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Size](https://img.shields.io/badge/size-~2KB-blue)](https://github.com/sulimanbenhalim/fit-to-page)

> HTML content → single PDF page when printing

Automatically measures rendered content and sets custom `@page` size to fit everything on one page. Works with browser's native print (Cmd+P / Ctrl+P).

## Install

### npm
```bash
npm install fit-to-page
```

### CDN
```html
<script src="https://cdn.jsdelivr.net/npm/fit-to-page@1.0.0/fit-to-page.js"></script>
```

### Manual
Download `fit-to-page.js` and include it in your HTML.

## Usage

### Basic
```html
<script src="fit-to-page.js"></script>
<script>
    FitToPage.init();
</script>
```

Press Cmd+P → Save as PDF → Everything fits on one page

### With Options
```javascript
FitToPage.init({
    selector: '.content',      // Element to measure
    margin: 10,                // Page margin (mm)
    padding: 5,                // Extra padding (mm)
    orientation: 'landscape',  // 'auto' | 'portrait' | 'landscape'
    debug: true,               // Show dimension info
    onReady: (info) => {
        console.log(info.pageSize);  // { width: 340, height: 550 }
    }
});
```

### Dynamic Content
```javascript
FitToPage.init({ selector: '#content' });

// Later, when content changes
document.getElementById('load-more').onclick = () => {
    // Load content...
    FitToPage.remeasure();
};
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `selector` | string | `'body'` | CSS selector of element to measure |
| `margin` | number | `10` | Page margin in mm |
| `padding` | number | `5` | Extra padding in mm |
| `dpi` | number | `96` | Screen DPI for px→mm conversion |
| `orientation` | string | `'auto'` | Page orientation |
| `debug` | boolean | `false` | Show dimension info box |
| `preventPageBreaks` | boolean | `true` | Prevent content breaking across pages |
| `onReady` | function | `null` | Callback when ready |

## How It Works

```
1. Measure content → 1200px × 1994px
2. Convert to mm → 317.5mm × 527.6mm
3. Add margins → 340mm × 550mm
4. Inject CSS → @page { size: 340mm 550mm; }
5. Print → One page PDF
```

## Examples

### Multi-column Layout
```html
<div class="grid" style="display: grid; grid-template-columns: 1fr 1fr;">
    <div>Column 1</div>
    <div>Column 2</div>
</div>

<script>
    FitToPage.init({ selector: '.grid', orientation: 'landscape' });
</script>
```

### Long Report
```html
<div class="report">
    <h1>Annual Report 2024</h1>
    <!-- Long content -->
</div>

<script>
    FitToPage.init({ selector: '.report', margin: 15 });
</script>
```

### Debug Mode
```javascript
FitToPage.init({
    debug: true,  // Shows info box with dimensions
    onReady: (info) => {
        console.log('Content:', info.width, '×', info.height);
        console.log('Page:', info.pageSize);
    }
});
```

## Comparison

| Feature | FitToPage | html2pdf.js | Puppeteer | Print.js |
|---------|-----------|-------------|-----------|----------|
| Native print (Cmd+P) | ✓ | ✗ | ✗ | ~ |
| Auto-fit one page | ✓ | ~ | ~ | ✗ |
| Text preserved | ✓ | ✗ | ✓ | ✓ |
| Client-side only | ✓ | ✓ | ✗ | ✓ |
| Zero dependencies | ✓ | ✗ | ✗ | ✗ |
| Size <5KB | ✓ | ✗ | ✗ | ✓ |

## Browser Support

| Browser | Supported |
|---------|-----------|
| Chrome | Yes |
| Edge | Yes |
| Firefox | Yes |
| Safari | No |

**Safari is not supported.** Safari ignores custom `@page { size }` declarations entirely — it computes page breaks before any print CSS or JavaScript is applied, which makes it impossible to dynamically set the page size from the browser. This is a fundamental limitation of Safari's print rendering engine and cannot be worked around client-side.

If you need single-page PDF output from Safari, consider a server-side solution such as Puppeteer or headless Chrome.

## License

MIT

## Author

Suliman Benhalim - soliman.benhalim@gmail.com
