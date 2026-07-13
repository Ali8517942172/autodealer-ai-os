---
name: browser-subagent-speed
description: >
  Production-grade playbook to maximize browser automation speed, reliability, and accuracy.
  Apply this skill for any browser_subagent task across all platforms.
---

# Browser Subagent Speed & Accuracy Playbook (Execution Policy)

## CORE PRINCIPLE
**Minimize actions, not reliability.**
The fastest automation is the one that succeeds on the first attempt.

---

## 0. DECISION ORDER (Highest ROI)

1. **Can this task be completed without the browser?** → Use API / filesystem / CLI / database.
2. **Is a direct URL available?** → Open it directly. Never ask the browser to search for information you already possess.
3. **Is DOM available?** → Use selectors.
4. **Is JS execution supported?** → Use JS.
5. **Is keyboard navigation sufficient?** → Use keyboard.
6. **Use mouse.**
7. **Use pixel clicks** only if nothing else works.

---

## 1. AGENT COGNITIVE BUDGETS

To prevent LLM over-thinking and reduce latency:

- **Planning Budget:** Think once. Plan once. Execute. Re-plan only after failure. Avoid repeated reasoning between every browser action.
- **Reasoning Rule:** Do not explain your reasoning internally after every click. Reason only when the page changed, an unexpected error occurred, or the goal changed.
- **Confidence Threshold:** If confidence >95%, execute immediately. Do not spend extra browser actions confirming obvious UI state.
- **Stop Exploration:** Never explore the UI. Navigate with intent. Every browser action must move directly toward the goal.
- **Scratchpad Budget:** Internal notes should remain under 5 lines. Do not repeatedly summarize completed work. Track only: Goal, Current page, Next action, Verification.

---

## 2. TOOL CALL & ACTION BUDGETS

Every tool call is expensive. Target per page whenever possible:
- ≤1 Screenshot
- ≤1 DOM Read
- ≤1 JS Execution
- ≤1 Wait

- **Action Batching:** If the tool allows multiple operations, batch them.
  ❌ SLOW: Click → Wait → Type → Wait → Click
  ✅ FAST: Focus → Fill all fields (using Tab) → Submit
- **Navigation Budget:** Avoid unnecessary navigation. Reuse current page, current tab, current login session, and browser context.

---

## 3. STATE AWARENESS & IDEMPOTENCY

Before changing anything: **Check current state.**
- If already configured, skip modification.
- Never recreate resources that already exist.

**Idempotency Rule:** Never repeat an action if success can be verified.
*Avoid:* Click Save → Click Save again
*Do:* Click Save → Verify success → Only retry if verification fails.

---

## 4. CAPTURE MINIMUM STATE REQUIRED (DOM Caching)

Capture only the minimum page state required (DOM, accessibility tree, or screenshot).
**Reuse the initial DOM whenever possible.** Do not request a fresh DOM unless:
- Page navigation occurred
- DOM changed significantly
- Previous selectors failed

**Selector Memory:** If a selector worked once on the current page, reuse it. Do not rediscover elements unless it fails.

If using Antigravity, limit to one initial state check:
```
Step 1: capture_browser_screenshot (SaveScreenshot: false)
Step 2: browser_get_dom
```

---

## 5. INTERACTION PRIORITY HIERARCHY

Follow this priority for the most reliable and fast execution:
1. **API** (Direct HTTP requests if possible)
2. **JavaScript** (Directly modifying values, triggering events)
3. **DOM Selector** (Clicking/typing via CSS selectors)
4. **Keyboard** (Tabbing, Enter)
5. **Mouse Click** (Visual element click)
6. **Pixel Click** (Exact X,Y coordinates)
7. **Image Recognition** (OCR based)

When you need to fill a form, find an element, or extract data, **prefer DOM or JS interaction when supported**.

---

## 6. NAVIGATE SMARTLY

Navigate directly whenever the destination URL is already known.
❌ SLOW: Go to Github → Search for repository named XYZ
✅ FAST: `open_browser_url` directly to `https://github.com/user/xyz`

*Note: Be careful with hardcoded IDs (like Team IDs) as they change. Use dynamic direct URLs when possible.*

---

## 7. CONDITION-BASED WAITS OVER FIXED WAITS

Priority for waiting:
1. Target element appears
2. Loading indicator disappears
3. Network idle
4. Fixed timeout (last resort)

If fixed waits are unavoidable, use the minimal necessary:
- After open_browser_url: wait 1000ms max
- After form submission: wait 500ms
- After clicking a button that opens a modal: wait 200ms
- Normal UI interactions: NO wait needed

---

## 8. EXTRACTION PRIORITY

Extract data using the following priority:
1. **DOM** (Elements, attributes)
2. **JavaScript** (`document.querySelector`)
3. **Accessibility tree**
4. **OCR** (Screenshot text)

---

## 9. HANDLE CANVAS UIS DIFFERENTLY

Canvas-based UIs cannot be read via DOM entirely. Strategy:
1. Take ONE screenshot to see the canvas state.
2. Use relative strategies when possible. If falling back to pixel coordinates, remember they fail on responsive UIs.
3. Avoid reading canvas content via DOM — but remember sidebars and dialogs DO have useful DOM.
4. Use the app's sidebar/panels for configuration.
5. Keyboard shortcuts work: `Ctrl+S`, `Escape`, `Tab`.

---

## 10. VERIFICATION HIERARCHY

Verify success using:
1. DOM state
2. URL change
3. Success notification
4. Expected value exists
5. Screenshot (Last resort)

---

## 11. FAILURE CLASSIFICATION & ERROR RECOVERY

**Recoverable Failures** (timeout, stale element, loading issue):
→ Refresh once → Re-read DOM → Retry once.

**Non-recoverable Failures** (permission denied, login required, missing resource):
→ Stop and report immediately.
**Never retry indefinitely.**

---

## QUOTA MANAGEMENT

- **Daily quota limit** — 429 error means quota exhausted
- **Cannot be bypassed** — must wait for reset (~18-24 hours)
- **Save quota by:** doing all code edits, git pushes, file writes WITHOUT browser agent
