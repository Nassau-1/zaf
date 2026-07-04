## 2026-06-01 - Command Injection in Git Clone via execSync
**Vulnerability:** Arbitrary command injection via unsanitized user inputs (`remoteUrl`) passed to `execSync` string interpolations for commands like `git clone`, `git config`, `git init`, and `git remote`.
**Learning:** Using string interpolation with `execSync` executes the entire string via a subshell by default, allowing attackers to terminate the intended command and inject their own using shell metacharacters (e.g., `;`, `&`, `|`).
**Prevention:** Use `execFileSync('git', ['clone', remoteUrl, ...])` instead. This bypasses the shell completely and directly invokes the executable with a safe array of arguments, preventing any injected shell operators from being evaluated.

## 2026-06-24 - Enhance URI decoding and boundary validation
**Learning:** Using `startsWith` for boundary validation without a path separator can allow prefix matching on longer paths. Also, not decoding URLs properly can incorrectly pass certain logic checks.
**Prevention:** Use `decodeURIComponent` in a try-catch block and always append `path.sep` to directory paths when using `startsWith`.

## 2026-11-20 - Arbitrary File Access via Template and Subdir Path Traversal
**Vulnerability:** Path traversal in `/api/repo/create` (`templateName`) and `/api/marketplace/preview` (`subdir`) allows arbitrary directory copying and information disclosure.
**Learning:** Concatenating user input with base directories using `path.join` or `path.resolve` without boundary validation allows traversal out of the intended directory context.
**Prevention:** Always validate that the resolved path starts with the intended base directory (using `startsWith(base + path.sep)`) and explicitly handle exact root directory matches separately.
