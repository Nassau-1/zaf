## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.

## 2024-10-21 - Semantic elements and ARIA labels for tabs
**Learning:** Non-semantic `<span>` elements used as close buttons for dynamic tabs lack keyboard tab support. Using `title` alone on icon-heavy elements isn't enough for screen readers when managing layout.
**Action:** Always convert custom interactive text elements (like '✕' close icons) to `<button>` with explicit `aria-label`s and proper CSS resets to maintain design while increasing accessibility.
