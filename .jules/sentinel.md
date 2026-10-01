## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-24 - Enhance URI decoding and boundary validation
**Learning:** Using `startsWith` for boundary validation without a path separator can allow prefix matching on longer paths. Also, not decoding URLs properly can incorrectly pass certain logic checks.
**Prevention:** Use `decodeURIComponent` in a try-catch block and always append `path.sep` to directory paths when using `startsWith`.

## 2026-10-01 - Command Injection in Custom Harness Registration
**Vulnerability:** The `/api/harness/custom` endpoint allows unsanitized strings for `versionCmd` which is later passed to `execSync(..., { shell: true })` in `/api/cli/status`. This enables arbitrary remote command injection via shell metacharacters like `;`, `&`, `|`, `>`, etc.
**Learning:** Even administrative or configuration inputs like "custom command definitions" are untrusted inputs when exposed via an HTTP API. Using `shell: true` with any part of these user-provided strings is critically dangerous.
**Prevention:** Validate all inputs intended for shell execution against a strict allowlist regex (e.g., `/^[a-zA-Z0-9\s\-_./@]+$/`) to reject any shell metacharacters before storing them.
