# Browser Subagent Policy

When operating the browser subagent for Make, Zapier, Render, n8n, etc., strictly follow the policies outlined in:

- `docs/browser_subagent_instructions.md`
- `~/.gemini/config/skills/browser-subagent-speed/SKILL.md`

## Summary of Core Rules:
1. Use browser only for UI tasks.
2. Reuse sessions (Stateful tabs).
3. No UI exploration. Direct URLs only.
4. Minimum screenshots (budget <= 2).
5. Verify success before retrying.
6. Use Execution Priority (API > URL > DOM > Keyboard > Click).
