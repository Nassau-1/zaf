## 2024-06-02 - ARIA Labels on Close Modals
**Learning:** Icon-only close buttons (like "✕") in the `dashboard/app.js` modals often lack `aria-label` attributes, which makes them inaccessible to screen readers. Tab close spans using the same icon lacked `role="button"` and keyboard accessibility (`tabindex="0"`).
**Action:** When adding new modals, tabs, or removable chips, ensure icon-only interactable elements always have `aria-label` and, if using non-semantic tags like `span` or `div`, add `role="button"` and `tabindex="0"`.
