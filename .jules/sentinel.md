## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-05 - Path Traversal Prefix Match Bypass
**Vulnerability:** Path traversal bypass in static file server (`dashboard/server.js`) via string prefix matching without a trailing slash (e.g., `filePath.startsWith(STATIC_DIR)` allowed `/app/dashboard-secrets` to bypass `/app/dashboard`) and missing URI component decoding.
**Learning:** `startsWith` on file paths is insecure if the base directory path is not strictly normalized with a trailing path separator, and raw requested paths must be fully decoded (and checked for null bytes) before applying `path.join()`.
**Prevention:** Always decode URL pathnames, explicitly reject poison null bytes (`\0`), and ensure base directory checks append a trailing slash (e.g., `STATIC_DIR + path.sep`) before executing `startsWith()`.
