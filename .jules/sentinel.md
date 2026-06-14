## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-14 - String Prefix Path Traversal and URI Decoding in Static File Servers
**Vulnerability:** Path traversal possible through string prefix bypass (`filePath.startsWith(STATIC_DIR)` allows `/app/dashboard-secret` when `STATIC_DIR` is `/app/dashboard`) and missing `decodeURIComponent` combined with poison null byte checks.
**Learning:** Always append `path.sep` when checking path boundaries using string prefixes (e.g., `filePath.startsWith(STATIC_DIR + path.sep)`) and explicitly handle exact matches. In Node.js custom servers, incoming request URLs must be decoded using `decodeURIComponent` inside a `try...catch` and validated against poison null bytes (`\0`) before any path resolution to prevent bypasses via URL-encoded characters.
**Prevention:** Use `filePath === DIR || filePath.startsWith(DIR + path.sep)` for boundary checks. Sanitize `pathname` with `decodeURIComponent(pathname)` and reject requests containing `\0`.
