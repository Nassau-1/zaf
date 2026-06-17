## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-18 - Path Traversal via URL Decoding and Prefix Match
**Vulnerability:** Path traversal and prefix bypass in static file server due to missing `decodeURIComponent` and an unsafe `startsWith` boundary check.
**Learning:** Node.js `url.parse` does not decode URL-encoded segments like `%2e%2e` (which bypasses relative path resolution), and `filePath.startsWith(DIR)` is vulnerable to prefix bypasses (e.g., `/app/dir-secrets` matches `/app/dir`). Furthermore, poison null bytes must be rejected.
**Prevention:** Always wrap `decodeURIComponent` in a try-catch for URL parsing, check for null bytes, and use `filePath === DIR || filePath.startsWith(DIR + path.sep)` for secure path boundary checks.
