## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2024-06-23 - URL decoding and strict path bounds for static files
**Vulnerability:** Static file serving path boundary logic was insufficient.
**Learning:** Checking path boundaries using string prefixing (`startsWith`) without `path.sep` allows traversal if a directory has the same prefix (e.g., `/app/dashboard-secret` starting with `/app/dashboard`).
**Prevention:** Always decode request URLs (`decodeURIComponent`) wrapped in `try...catch`, check for poison null bytes, and ensure strict bounds checking (`filePath === DIR || filePath.startsWith(DIR + path.sep)`).
