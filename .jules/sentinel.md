## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-24 - Enhance URI decoding and boundary validation
**Learning:** Using `startsWith` for boundary validation without a path separator can allow prefix matching on longer paths. Also, not decoding URLs properly can incorrectly pass certain logic checks.
**Prevention:** Use `decodeURIComponent` in a try-catch block and always append `path.sep` to directory paths when using `startsWith`.

## 2023-10-27 - Command Injection in versionCmd via execSync
**Vulnerability:** Arbitrary command injection via unsanitized `versionCmd` inputs in the CLI Hub status endpoint (`/api/cli/status`), resulting from passing user input directly to `execSync` with `shell: true`.
**Learning:** Custom harnesses allow arbitrary execution commands to be specified and then later executed. Using `execSync` with `shell: true` evaluates the command via a subshell, allowing attackers to inject commands with shell metacharacters.
**Prevention:** Use a shell parser like `shell-quote` to safely break the command string into an array of arguments, filtering out operators, and execute it securely via `execFileSync` to bypass the shell.
