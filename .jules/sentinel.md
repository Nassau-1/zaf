## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-01 - Path Traversal via startsWith Bypass and Missing Decode
**Vulnerability:** Path traversal in static file serving logic due to `startsWith` prefix bypass (e.g., `/app/dashboard-secret` starts with `/app/dashboard`) and missing `decodeURIComponent` (allowing `%2e%2e` payloads to bypass `path.join`).
**Learning:** `path.join` treats URL-encoded characters as literal, so `decodeURIComponent` must be called first. Also, `startsWith(DIR)` is vulnerable to prefix bypass; always append `path.sep` (e.g., `startsWith(DIR + path.sep)`) and explicitly handle exact root directory matches. Finally, explicitly block poison null bytes (`%00` / `\0`).
**Prevention:** Always decode paths, reject null bytes, and use `path.sep` when checking path boundaries.
