## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-13 - Path Traversal Prefix Bypass & Missing Decode in Static Server
**Vulnerability:** Arbitrary file read due to missing `decodeURIComponent` on URL pathnames and an insecure `startsWith` prefix check (e.g., `/app/dashboard-secrets` bypassing `/app/dashboard`).
**Learning:** Node.js `url.parse` returns pathnames URL-encoded. Without decoding, path traversal payloads like `%2e%2e/` pass strict string matching since they don't normalize to `../` until later or avoid being caught. Furthermore, checking boundaries using `path.startsWith(DIR)` is vulnerable to prefix bypasses.
**Prevention:** Always `decodeURIComponent` the path, reject poison null bytes (`\0`), and append `path.sep` (e.g., `path.startsWith(DIR + path.sep)`) when performing directory boundary checks, explicitly handling exact root directory matches.
