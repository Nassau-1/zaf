## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-24 - Enhance URI decoding and boundary validation
**Learning:** Using `startsWith` for boundary validation without a path separator can allow prefix matching on longer paths. Also, not decoding URLs properly can incorrectly pass certain logic checks.
**Prevention:** Use `decodeURIComponent` in a try-catch block and always append `path.sep` to directory paths when using `startsWith`.

## 2024-05-18 - [Command Injection via customHarnesses]
**Vulnerability:** The `/api/cli/status` endpoint in `dashboard/server.js` dynamically executes a command using `execSync(versionCmd, { shell: true })`. `versionCmd` can be user-controlled data provided via the `customHarnesses` configuration. This constitutes a command injection vulnerability because an attacker can embed shell metacharacters in the custom harness's `versionCmd` field.
**Learning:** Even when the command originates from a configuration file, if that file can be modified by the user or an API endpoint, it should be treated as untrusted input. `execSync` with `shell: true` is inherently dangerous when any part of the command string is derived from outside the immediate hardcoded application context.
**Prevention:** Avoid `shell: true`. Use `shell-quote` to securely parse command strings into argument arrays, filter out non-string AST objects, and use `execFileSync` to execute the command directly without a shell layer.
