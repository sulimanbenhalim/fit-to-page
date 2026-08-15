/**
 * FitToPage.js - Automatically fit HTML content to a single PDF page
 * @version 1.0.0
 * @license MIT
 * @author Suliman Benhalim
 * @description Lightweight library that measures your content and dynamically sets
 * the @page size to fit everything on one page when printing to PDF
 */

(function(window) {
    'use strict';

    const MM_PER_INCH = 25.4;

    // PDF's architectural limit is 14400 user-space units (200in) per side.
    // A larger page cannot be represented, so the output spills onto more sheets.
    const MAX_PAGE_MM = 200 * MM_PER_INCH;

    const VALID_ORIENTATIONS = ['auto', 'portrait', 'landscape'];

    const FitToPage = {
        version: '1.0.0',

        /**
         * Default configuration
         */
        defaults: {
            selector: 'body',           // Element to measure
            margin: 10,                 // Page margin in mm
            padding: 5,                 // Extra padding in mm
            dpi: 96,                    // Screen DPI (96 is standard)
            orientation: 'auto',        // 'auto', 'portrait', or 'landscape'
            debug: false,               // Show dimension info box
            preventPageBreaks: true,    // Prevent content from breaking across pages
            onReady: null              // Callback when ready
        },

        /**
         * Current configuration
         */
        config: {},

        /**
         * Initialize the library
         * @param {Object} options - Configuration options
         */
        init: function(options) {
            this.config = this.resolveConfig(options);

            // Images and stylesheets are still in flight at DOMContentLoaded, so
            // measuring there reports content shorter than it ends up being and
            // the overflow lands on a second page. 'complete' is the first point
            // at which layout is final.
            if (document.readyState === 'complete') {
                this.measure();
            } else {
                window.addEventListener('load', () => this.measure(), { once: true });
            }
        },

        /**
         * Merge options over the defaults, rejecting values that would produce an
         * unusable @page rule.
         * @param {Object} options - Configuration options
         * @returns {Object} Validated configuration
         */
        resolveConfig: function(options) {
            const config = Object.assign({}, this.defaults);

            // Object.assign copies an explicit undefined straight over the default,
            // so `init({ dpi: someUnsetVar })` would divide by undefined and put
            // NaN in the @page size, voiding the declaration.
            Object.keys(options || {}).forEach((key) => {
                if (options[key] !== undefined) {
                    config[key] = options[key];
                }
            });

            ['dpi', 'margin', 'padding'].forEach((key) => {
                const value = Number(config[key]);
                const usable = isFinite(value) && (key === 'dpi' ? value > 0 : value >= 0);

                if (!usable) {
                    console.warn(`FitToPage: ignoring invalid ${key} "${config[key]}", using ${this.defaults[key]}`);
                    config[key] = this.defaults[key];
                } else {
                    config[key] = value;
                }
            });

            if (VALID_ORIENTATIONS.indexOf(config.orientation) === -1) {
                console.warn(`FitToPage: unknown orientation "${config.orientation}", using "auto"`);
                config.orientation = this.defaults.orientation;
            }

            return config;
        },

        /**
         * Convert pixels to millimeters
         * @param {number} px - Pixels
         * @returns {number} Millimeters
         */
        pxToMm: function(px) {
            return (px * MM_PER_INCH / this.config.dpi);
        },

        /**
         * Format a millimeter value as a CSS length, rounded up to the next 0.1mm.
         * toFixed() rounds to nearest, which can declare a page up to 0.05mm
         * smaller than the content needs and push the overflow onto a second page.
         * @param {number} mm - Millimeters
         * @returns {string} CSS length
         */
        toMm: function(mm) {
            // The epsilon keeps a value already on a 0.1mm boundary from being
            // nudged up a step by binary floating point.
            return (Math.ceil((mm * 10) - 1e-9) / 10).toFixed(1) + 'mm';
        },

        /**
         * Smallest page that holds the content and satisfies the requested
         * orientation. A forced orientation grows the short side; swapping the two
         * would leave the page smaller than the content it has to hold.
         * @param {number} widthMm - Width the content needs
         * @param {number} heightMm - Height the content needs
         * @returns {{width: number, height: number}} Page size in mm
         */
        fitPage: function(widthMm, heightMm) {
            if (this.config.orientation === 'landscape') {
                return { width: Math.max(widthMm, heightMm), height: heightMm };
            }

            if (this.config.orientation === 'portrait') {
                return { width: widthMm, height: Math.max(widthMm, heightMm) };
            }

            return { width: widthMm, height: heightMm };
        },

        /**
         * Measure content dimensions
         * @returns {Object|null} Measurements, or null when the element is missing
         */
        measure: function() {
            const element = document.querySelector(this.config.selector);

            if (!element) {
                console.error(`FitToPage: Element "${this.config.selector}" not found`);
                return null;
            }

            // Get actual rendered dimensions
            const width = element.scrollWidth;
            const height = element.scrollHeight;

            if (width <= 0 || height <= 0) {
                console.warn(`FitToPage: "${this.config.selector}" measured ${width}x${height}px - hidden or empty content cannot be fitted`);
            }

            // The page carries the content, a margin on both sides and the padding
            // as slack, which leaves a printable area of content + padding.
            const overheadMm = (this.config.margin * 2) + this.config.padding;
            const widthMm = this.pxToMm(width) + overheadMm;
            const heightMm = this.pxToMm(height) + overheadMm;

            const page = this.fitPage(widthMm, heightMm);

            if (page.width > MAX_PAGE_MM || page.height > MAX_PAGE_MM) {
                console.warn(`FitToPage: ${page.width.toFixed(1)}x${page.height.toFixed(1)}mm exceeds the ${MAX_PAGE_MM}mm PDF page limit - the output will span multiple pages`);
            }

            // Inject CSS
            this.injectCSS(page.width, page.height);

            // Show debug info if enabled
            if (this.config.debug) {
                this.showDebugInfo(width, height, page.width, page.height);
            }

            const info = {
                width: { px: width, mm: widthMm },
                height: { px: height, mm: heightMm },
                pageSize: { width: page.width, height: page.height }
            };

            // Call ready callback
            if (typeof this.config.onReady === 'function') {
                this.config.onReady(info);
            }

            return info;
        },

        /**
         * Inject dynamic CSS for print
         * @param {number} width - Page width in mm
         * @param {number} height - Page height in mm
         */
        injectCSS: function(width, height) {
            const styleId = 'fit-to-page-styles';

            // Remove existing style if present
            const existingStyle = document.getElementById(styleId);
            if (existingStyle) {
                existingStyle.remove();
            }

            const css = `
                @page {
                    size: ${this.toMm(width)} ${this.toMm(height)};
                    margin: ${this.config.margin}mm;
                }

                @media print {
                    ${this.config.preventPageBreaks ? `
                    * {
                        page-break-inside: avoid !important;
                        break-inside: avoid !important;
                    }

                    ${this.config.selector} {
                        page-break-after: avoid !important;
                        max-width: 100%;
                    }
                    ` : ''}

                    .fit-to-page-debug {
                        display: none !important;
                    }
                }
            `;

            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = css;
            document.head.appendChild(style);
        },

        /**
         * Show debug information box
         * @param {number} widthPx - Width in pixels
         * @param {number} heightPx - Height in pixels
         * @param {number} pageWidth - Page width in mm
         * @param {number} pageHeight - Page height in mm
         */
        showDebugInfo: function(widthPx, heightPx, pageWidth, pageHeight) {
            const debugId = 'fit-to-page-debug-box';

            // Remove existing debug box if present
            const existingDebug = document.getElementById(debugId);
            if (existingDebug) {
                existingDebug.remove();
            }

            const debugBox = document.createElement('div');
            debugBox.id = debugId;
            debugBox.className = 'fit-to-page-debug';
            debugBox.style.cssText = `
                position: fixed;
                top: 10px;
                left: 10px;
                background: #1a1a1a;
                color: white;
                padding: 15px;
                font-family: monospace;
                font-size: 12px;
                z-index: 999999;
                border-radius: 5px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.3);
                max-width: 300px;
            `;

            // Report the same rounded values that went into the @page rule, so the
            // box never disagrees with what the browser was actually told.
            debugBox.innerHTML = `
                <strong>📄 FitToPage Debug</strong><br><br>
                <strong>Content:</strong><br>
                ${widthPx}px × ${heightPx}px<br>
                ${this.pxToMm(widthPx).toFixed(1)}mm × ${this.pxToMm(heightPx).toFixed(1)}mm<br><br>
                <strong>PDF Page Size:</strong><br>
                ${this.toMm(pageWidth)} × ${this.toMm(pageHeight)}<br><br>
                <em>Press Cmd+P / Ctrl+P to test!</em>
            `;

            document.body.appendChild(debugBox);
        },

        /**
         * Manually trigger remeasure (useful for dynamic content)
         * @returns {Object|null} Measurements, or null when the element is missing
         */
        remeasure: function() {
            return this.measure();
        }
    };

    // Expose to global scope
    window.FitToPage = FitToPage;

    // Also support module exports
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = FitToPage;
    }

})(typeof window !== 'undefined' ? window : this);
