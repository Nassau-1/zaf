## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-08 - Path Traversal in Static File Server
**Vulnerability:** Arbitrary path traversal and directory bypass via unsanitized `pathname` values during static file serving, combined with a flawed `startsWith` boundary check and no null-byte handling.
**Learning:** `startsWith` is vulnerable to prefix bypasses (e.g., `/app/dashboard-secret.txt` starts with `/app/dashboard`). Also, HTTP requests don't automatically `decodeURIComponent`, meaning encoded traversals (`%2e%2e%2f`) bypass rudimentary literal checks.
**Prevention:** Use `path.sep` to ensure exact boundary matching (`filePath.startsWith(STATIC_DIR + path.sep)`), manually decode URI components (`decodeURIComponent`), and strictly reject null bytes (`\0`, `%00`) prior to resolution.
