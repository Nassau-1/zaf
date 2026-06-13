## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.
## 2026-06-13 - Path Traversal Vulnerability in Static Server
**Vulnerability:** The static file server used a naive `path.startsWith(STATIC_DIR)` check and did not decode the URL or check for poison null bytes, allowing path traversal using URL-encoded characters and string prefix bypass (e.g., `../dashboard-secret`).
**Learning:** Always `decodeURIComponent` and check for poison null bytes `\0`. Use `path.startsWith(STATIC_DIR + path.sep)` to properly enforce directory boundaries.
**Prevention:** Use robust URL decoding and precise directory boundary checks including trailing separators.
