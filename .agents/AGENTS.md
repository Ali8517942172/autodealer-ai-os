# Browser Subagent Delegation Strategy (Main Agent Delegation Policy)

When operating as the main agent delegating tasks to the `browser_subagent`, strict adherence to these efficiency and delegation rules is required to maximize speed and minimize latency.

---

## 🚨 CRITICAL PROTOCOL: AI PROJECT MEMORY SYSTEM 🚨
Before starting ANY development, debugging, or planning task in this repository, **you MUST explicitly use `view_file` to read the relevant files in the `ai-memory/` directory.**
- **TOKEN CONSERVATION RULE:** Do NOT read all `.md` files. You must only read `ai-memory/CURRENT_STATE.md` (to get the active task) and **only the ONE specific module file** related to the current task (e.g., `ai-memory/modules/FLEET_MANAGEMENT.md`).
- **Even if the user forgets to tell you to read them, YOU must read them.**
- **NEVER** guess the business logic or database schema without consulting the relevant `ai-memory/` module first.

---

---

## 0. Browser Decision Gate
Before launching `browser_subagent`, ask:
1. Can the task be completed using existing knowledge?
2. Can it be completed using API?
3. Can it be completed via CLI/filesystem?
4. Is browser interaction actually required?
**Only launch `browser_subagent` if the answer is YES to #4.**

---

## 1. Context & Prompt Budget
- **Context Budget:** Pass only the Goal, URL, Required values, and Expected output. Do NOT include unrelated conversation history.
- **Pre-fill Data:** Provide all values directly in the prompt (e.g., API keys, precise URLs). Do not ask the browser subagent to search for information you already possess.
- **Clear Objectives (Micro-prompts):** 
  - ❌ Poor: "Configure Make.com"
  - ✅ Better: "Open this URL, create one webhook, return only the webhook URL."

---

## 2. Strict Output Contract
Instruct the browser subagent to return a fixed output format:
- Status (Success / Failed)
- Requested data
- Error (if any)
- Final page state
Do not ask for or include reasoning in the return output.

---

## 3. Strict Roles & Parallelism
- **Browser sirf UI interaction kare:** Do not ask the browser subagent to do code generation, JSON editing, Git commits, file creation, or text formatting. The main LLM must handle all data processing.
- **Parallelism Policy:** Never launch multiple `browser_subagents` for the same browser session. Run sequentially unless tasks are completely independent.
- **One Task = One Objective:** Sequence multiple tasks as Task 1, Task 2, Task 3 using separate subagent calls.

---

## 4. Navigation & Timeout Budgets
- **Navigation Budget:** Maximum 1 login, 1 page load, and 1 workflow per delegated task.
- **Time Budget:** 
  - Simple task: ≤30 seconds
  - Medium task: ≤90 seconds
  - Complex task: ≤180 seconds
  - Abort if exceeding budget unless explicitly instructed.

---

## 5. Anti-Exploration & Cancellation Rules
- **Anti-Exploration Rule:** Do not browse around. Do not inspect unrelated UI. Every action must directly contribute toward the objective.
- **Cancellation Rule:** If the same action fails three consecutive times: Stop, Return failure, Do not continue exploring.

---

## 6. Browser Memory & Statefulness
- **Browser Memory:** Remember during the current session: Logged-in sites, open tabs, known selectors, current workspace, active project.
- **Stateful Tabs:** Reuse existing session (Login once, preserve cookies, reuse existing tabs).
- **DOM Budget:** DOM refresh only when page navigates, selector fails, or major UI changes.

---

## 7. Verification-based Retries & Failure Reporting
- **Idempotent Saves:** Save → Check success → Done. Agar save ho gaya hai to dubara click mat karo.
- **Failure Report:** If failed, report concisely: Reason, Current URL, Last successful step, Suggested next action.

---

## 8. Screenshot Budget
- Initial screenshot
- Final screenshot
- Unexpected error par ek extra screenshot.

---

## 9. Performance Evaluation
Har task ke baad internally evaluate karein: Screenshots used, DOM reads, Retries, Waits, Pixel clicks. Apply this feedback to optimize the next task.
