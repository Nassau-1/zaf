## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.
## 2026-06-15 - [Path Traversal & Poison Null Byte in Static Server]
**Vulnerability:** Static file serving was vulnerable to path traversal via prefix bypass (`/../dashboard-secrets.txt`), URL-encoded paths, and poison null bytes.
**Learning:** `path.startsWith(DIR)` matches prefix strings (e.g. `/dir-secret` matches `/dir`), and URL parsing in Node.js does not decode URIs or handle null bytes by default.
**Prevention:** Always append `path.sep` when checking boundaries (`startsWith(DIR + path.sep)`), and decode and sanitize request URIs at the start of the request handler.
