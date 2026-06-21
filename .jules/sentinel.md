## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2025-02-20 - Fix Path Traversal in Static File Server
**Vulnerability:** Path traversal vulnerability due to insufficient prefix checking and decoding order in the static file server logic in `dashboard/server.js`.
**Learning:** Using `filePath.startsWith(STATIC_DIR)` without appending `path.sep` allows prefix bypass attacks (e.g., `/app/dashboard-secret`). In addition, `decodeURIComponent` needs to be used on the pathname and checked for null bytes to prevent URL encoding bypasses.
**Prevention:** Always append `path.sep` when performing prefix checks for paths, use `decodeURIComponent` with `try...catch`, and check for poison null bytes before path resolution.
