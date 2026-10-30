## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-24 - Enhance URI decoding and boundary validation
**Learning:** Using `startsWith` for boundary validation without a path separator can allow prefix matching on longer paths. Also, not decoding URLs properly can incorrectly pass certain logic checks.
**Prevention:** Use `decodeURIComponent` in a try-catch block and always append `path.sep` to directory paths when using `startsWith`.

## 2026-06-25 - Shell argument parsing for command injection mitigation
**Vulnerability:** Command injection when using `execFileSync` by attempting to parse complex shell strings with tools like `shell-quote`, which produce un-executable AST objects instead of simple string arrays for shell operators.
**Learning:** `execFileSync` does not invoke a shell, so it cannot handle shell pipelines (`|`), logical operators (`&&`), environment variable assignments (e.g. `ENV=1 cmd`), or native Windows scripts (`.cmd`/`.bat`) natively if passed as parsed arrays with special AST objects.
**Prevention:** Avoid refactoring to `execFileSync` if the underlying command needs full shell evaluation, or if the source of the command string is a trusted internal registry rather than unsanitized user input.
