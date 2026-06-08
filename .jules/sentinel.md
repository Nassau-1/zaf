## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.
## 2026-06-08 - Path Traversal Prefix Bypass
**Vulnerability:** Static file serving checked `filePath.startsWith(STATIC_DIR)` which allows path traversal bypasses. For example, `/app/dashboard-secret` starts with `/app/dashboard`.
**Learning:** Using `path.startsWith(DIR)` is vulnerable to string prefix bypasses because it treats paths as plain strings rather than directory hierarchies.
**Prevention:** Always append `path.sep` (e.g., `path.startsWith(DIR + path.sep)`) and explicitly handle exact root directory matches separately when checking path boundaries.
