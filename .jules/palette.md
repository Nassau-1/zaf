## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.
## 2024-09-04 - Form Label Accessibility
**Learning:** Found widespread missing `for` attributes on `<label>` elements associated with form controls across the dashboard configuration modals and panels. This breaks programmatic association for screen readers, meaning users navigating via assistive technology wouldn't hear the label text when focusing on the inputs.
**Action:** Always ensure `<label>` elements use the `for` attribute (or `htmlFor` in JSX) matching the exact `id` of their target input, select, or textarea to guarantee accessible programmatic association.
