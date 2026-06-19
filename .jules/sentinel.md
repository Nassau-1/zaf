## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.
## 2026-06-19 - Path Traversal in Static File Server
**Vulnerability:** Arbitrary file read via URL-encoded path traversal (`/%2e%2e/`) and string prefix bypass (`startsWith(DIR)`) in `dashboard/server.js`.
**Learning:** `http.createServer` handlers do not automatically decode URLs, and `startsWith(DIR)` allows bypasses if the target matches the prefix but is not a sub-directory (e.g. `/app/dir-secret`).
**Prevention:** Use `decodeURIComponent` wrapped in a `try...catch` to sanitize URLs, block poison null bytes (`\0`), and append `path.sep` to directory boundary checks (e.g., `startsWith(DIR + path.sep)`).
