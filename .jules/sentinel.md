## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-06 - [Critical Path Traversal via startsWith Bypass]
**Vulnerability:** Path traversal possible because `filePath.startsWith(STATIC_DIR)` only checks string prefix. An attacker could request `/../dashboard-secret` which gets joined as `/path/to/dashboard-secret`, still starting with `/path/to/dashboard`, bypassing the check. Also lacked URI decoding and null byte checks.
**Learning:** `startsWith` on file paths without appending `path.sep` allows accessing sibling directories with the same prefix. URL decoding must be performed before path resolution.
**Prevention:** Use `decodeURIComponent`, check for `\0`, and validate boundaries using `filePath.startsWith(STATIC_DIR + path.sep) && filePath !== STATIC_DIR` to ensure the resolved path remains strictly within the target directory.
