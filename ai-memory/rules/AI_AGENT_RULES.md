# AI Agent Rules


Before executing:

1. Understand business goal.
2. Check existing workflow in `/ai-memory/CURRENT_STATE.md`.
3. Modify minimum required files.


Never:

- Break existing booking logic.
- Delete production data.
- Change database schema without approval.


Always:

- Verify result.
- Update `ai-memory/CURRENT_STATE.md` (check off tasks, add new bugs).
- Update the relevant module file (e.g., `ai-memory/modules/CRM.md`) if business logic or architecture changes.
- Update `ai-memory/JD_MAPPING.md` if a new technology or JD requirement is successfully implemented.
- **You are the sole maintainer of the `ai-memory` directory. The user should NEVER have to manually update these markdown files.**
