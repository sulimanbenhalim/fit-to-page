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
            this.config = Object.assign({}, this.defaults, options);

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.measure());
            } else {
                this.measure();
            }
        },

        /**
         * Convert pixels to millimeters
         * @param {number} px - Pixels
         * @returns {number} Millimeters
         */
        pxToMm: function(px) {
            return (px * 25.4 / this.config.dpi);
        },

        /**
         * Measure content dimensions
         */
        measure: function() {
            const element = document.querySelector(this.config.selector);

            if (!element) {
                console.error(`FitToPage: Element "${this.config.selector}" not found`);
                return;
            }

            // Get actual rendered dimensions
            const width = element.scrollWidth;
            const height = element.scrollHeight;

            // Convert to mm and add margins
            const widthMm = this.pxToMm(width) + (this.config.margin * 2) + this.config.padding;
            const heightMm = this.pxToMm(height) + (this.config.margin * 2) + this.config.padding;

            // Determine orientation
            let pageWidth = widthMm;
            let pageHeight = heightMm;

            if (this.config.orientation === 'landscape' ||
                (this.config.orientation === 'auto' && widthMm > heightMm)) {
                // Ensure landscape
                pageWidth = Math.max(widthMm, heightMm);
                pageHeight = Math.min(widthMm, heightMm);
            } else if (this.config.orientation === 'portrait' ||
                       (this.config.orientation === 'auto' && heightMm >= widthMm)) {
                // Ensure portrait
                pageWidth = Math.min(widthMm, heightMm);
                pageHeight = Math.max(widthMm, heightMm);
            }

            // Inject CSS
            this.injectCSS(pageWidth, pageHeight);

            // Show debug info if enabled
            if (this.config.debug) {
                this.showDebugInfo(width, height, pageWidth, pageHeight);
            }

            // Call ready callback
            if (typeof this.config.onReady === 'function') {
                this.config.onReady({
                    width: { px: width, mm: widthMm },
                    height: { px: height, mm: heightMm },
                    pageSize: { width: pageWidth, height: pageHeight }
                });
            }
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
                    size: ${width.toFixed(1)}mm ${height.toFixed(1)}mm;
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

            debugBox.innerHTML = `
                <strong>📄 FitToPage Debug</strong><br><br>
                <strong>Content:</strong><br>
                ${widthPx}px × ${heightPx}px<br>
                ${this.pxToMm(widthPx).toFixed(1)}mm × ${this.pxToMm(heightPx).toFixed(1)}mm<br><br>
                <strong>PDF Page Size:</strong><br>
                ${pageWidth.toFixed(1)}mm × ${pageHeight.toFixed(1)}mm<br><br>
                <em>Press Cmd+P / Ctrl+P to test!</em>
            `;

            document.body.appendChild(debugBox);
        },

        /**
         * Manually trigger remeasure (useful for dynamic content)
         */
        remeasure: function() {
            this.measure();
        }
    };

    // Expose to global scope
    window.FitToPage = FitToPage;

    // Also support module exports
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = FitToPage;
    }

})(typeof window !== 'undefined' ? window : this);
