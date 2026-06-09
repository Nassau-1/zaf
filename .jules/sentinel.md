## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-09 - Path Traversal Prefix Bypass
**Vulnerability:** Static file server path check used `startsWith(DIR)` without `path.sep`, allowing access to sibling directories matching the prefix. It also failed to decode URIs and check for poison null bytes.
**Learning:** `path.startsWith(DIR)` is vulnerable to prefix bypasses (e.g., `/app/dir-secrets` starts with `/app/dir`). Null bytes and URI encoded strings can bypass validation.
**Prevention:** Always decode URIs, reject null bytes, and use `path.startsWith(DIR + path.sep)` to ensure the path is strictly within the directory boundary.
