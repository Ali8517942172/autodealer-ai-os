/** @type {import('tailwindcss').Config} */
export default {
            // Without `content`, Tailwind scans nothing and emits no utility
            // classes at all — the build "succeeds" but ships a 7 kB stylesheet
            // and the dashboard renders as unstyled HTML.
            content: [
                './index.html',
                './contract-auditor.html',
                './app.js',
                './contract-auditor.js'
            ],
            // app.js builds these class names at runtime (`bg-status-${tone}-light`),
            // so the scanner cannot see them in the source.
            safelist: [
                'bg-status-hot', 'bg-status-warm', 'bg-status-cold', 'bg-status-good',
                'bg-status-hot-light', 'bg-status-warm-light', 'bg-status-cold-light', 'bg-status-good-light',
                'text-status-hot', 'text-status-warm', 'text-status-cold', 'text-status-good',
                'border-status-hot/30', 'border-status-warm/30'
            ],
            darkMode: "class",
            theme: {
                extend: {
                    "colors": {
                        "on-secondary-container": "#586579",
                        "on-primary": "#ffffff",
                        "secondary-fixed-dim": "#bac7de",
                        "surface-variant": "#e4e2e3",
                        "primary-container": "#141b2c",
                        "surface-container-lowest": "#ffffff",
                        "primary-fixed-dim": "#bfc6dc",
                        "on-tertiary": "#ffffff",
                        "outline-variant": "#c6c6cd",
                        "primary": "#000000",
                        "on-surface": "#1b1b1d",
                        "tertiary-fixed-dim": "#dcc3a0",
                        "surface-dim": "#dcd9db",
                        "on-surface-variant": "#45474c",
                        "primary-fixed": "#dbe2f9",
                        "surface-bright": "#fcf8fa",
                        "surface-container": "#f0edef",
                        "on-secondary": "#ffffff",
                        "inverse-surface": "#303032",
                        "surface-tint": "#565e71",
                        "on-secondary-fixed": "#0f1c2d",
                        "on-error": "#ffffff",
                        "tertiary-container": "#261903",
                        "inverse-primary": "#bfc6dc",
                        "on-background": "#1b1b1d",
                        "on-error-container": "#93000a",
                        "on-primary-fixed-variant": "#3f4759",
                        "secondary-fixed": "#d6e3fb",
                        "on-tertiary-fixed-variant": "#564429",
                        "tertiary-fixed": "#fadeba",
                        "on-tertiary-container": "#968061",
                        "on-secondary-fixed-variant": "#3b485a",
                        "secondary-container": "#d6e3fb",
                        "tertiary": "#000000",
                        "on-primary-fixed": "#141b2c",
                        "inverse-on-surface": "#f3f0f1",
                        "secondary": "#525f73",
                        "error": "#ba1a1a",
                        "on-tertiary-fixed": "#261903",
                        "on-primary-container": "#7c8498",
                        "surface-container-highest": "#e4e2e3",
                        "outline": "#76777d",
                        "background": "#fcf8fa",
                        "surface-container-low": "#f6f3f4",
                        "surface": "#fcf8fa",
                        "surface-container-high": "#eae7e9",
                        "error-container": "#ffdad6"
                    },
                    "borderRadius": {
                        "DEFAULT": "0.25rem",
                        "lg": "0.5rem",
                        "xl": "0.75rem",
                        "full": "9999px"
                    },
                    "spacing": {
                        "internal-stack": "8px",
                        "grid-columns": "12",
                        "container-padding": "24px",
                        "card-gap": "20px",
                        "element-padding": "16px"
                    },
                    "fontFamily": {
                        "kpi-value-mobile": ["Inter"],
                        "table-header": ["Inter"],
                        "label-caps": ["Inter"],
                        "kpi-value": ["Inter"],
                        "body-md": ["Inter"],
                        "sub-label": ["Inter"]
                    },
                    "fontSize": {
                        "kpi-value-mobile": ["24px", { "lineHeight": "32px", "fontWeight": "600" }],
                        "table-header": ["12px", { "lineHeight": "18px", "fontWeight": "500" }],
                        "label-caps": ["11px", { "lineHeight": "16px", "letterSpacing": "0.05em", "fontWeight": "600" }],
                        "kpi-value": ["30px", { "lineHeight": "38px", "letterSpacing": "-0.02em", "fontWeight": "600" }],
                        "body-md": ["14px", { "lineHeight": "20px", "fontWeight": "400" }],
                        "sub-label": ["13px", { "lineHeight": "18px", "fontWeight": "400" }]
                    },
                    "boxShadow": {
                        'kpi': '0px 4px 6px -1px rgba(0,0,0,0.1), 0px 2px 4px -1px rgba(0,0,0,0.06)',
                    }
                }
            }
        };
