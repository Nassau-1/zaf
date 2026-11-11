## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-24 - Enhance URI decoding and boundary validation
**Learning:** Using `startsWith` for boundary validation without a path separator can allow prefix matching on longer paths. Also, not decoding URLs properly can incorrectly pass certain logic checks.
**Prevention:** Use `decodeURIComponent` in a try-catch block and always append `path.sep` to directory paths when using `startsWith`.

## 2025-02-27 - [CRITICAL] Fix command injection in CLI status endpoint
**Vulnerability:** Command injection in `/api/cli/status` via `execSync(..., { shell: true })` using an improperly sanitized `versionCmd`.
**Learning:** Even internal configuration commands can be a vector for command injection if they pass through `shell: true`. User-provided configurations (e.g., custom harnesses) could execute arbitrary code on the server.
**Prevention:** Always use `execFileSync` or `spawn` with `shell: false` and explicitly parsed argument arrays instead of relying on shell evaluation. Use libraries like `shell-quote` to safely parse command strings.
