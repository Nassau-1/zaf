## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-24 - Enhance URI decoding and boundary validation
**Learning:** Using `startsWith` for boundary validation without a path separator can allow prefix matching on longer paths. Also, not decoding URLs properly can incorrectly pass certain logic checks.
**Prevention:** Use `decodeURIComponent` in a try-catch block and always append `path.sep` to directory paths when using `startsWith`.

## 2026-06-25 - Command Injection in Version Checking
**Vulnerability:** Arbitrary command injection via unsanitized inputs (`versionCmd`) passed to `execSync` with `shell: true` in `dashboard/server.js` when checking harness status.
**Learning:** Using `execSync` with `shell: true` evaluates the command through a subshell, which means if `versionCmd` is populated from an external or unsanitized source (like a custom harness config), an attacker could append arbitrary shell commands (e.g. `; rm -rf /`).
**Prevention:** Avoid `shell: true`. Use `execFileSync` (or `spawn` with `shell: false`) by splitting the command into an array of arguments, so that no shell metacharacters are evaluated.
