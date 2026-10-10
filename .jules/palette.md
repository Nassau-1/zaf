## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.

## 2024-10-09 - Custom Controls and Tab Accessibility
**Learning:** Found custom interactive elements (like custom tabs and zoom controls) lacking semantic HTML tags, accessible names, and focus indicators.
**Action:** Always use `<button>` tags for interactive custom controls, provide them with `aria-label` attributes if they are icon-only, and ensure they have visible focus outlines.
