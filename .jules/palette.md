## 2024-05-31 - Initial Setup
**Learning:** Found no accessibility focus indicators in the dashboard buttons.
**Action:** Always add focus-visible styles to interactive elements for better keyboard navigation.

## 2024-06-03 - Modal Close Button Accessibility
**Learning:** Icon-only modal close buttons lacked ARIA labels and focus-visible states, making them inaccessible for screen readers and keyboard users.
**Action:** Always add aria-label="Close" and :focus-visible outlines to icon-only buttons to ensure they are fully accessible.

## 2024-07-11 - focus-visible offset on colored buttons
**Learning:** Adding a focus-visible outline with a negative offset (e.g. -2px) on solid-colored buttons makes the focus ring invisible if it shares the button's background color.
**Action:** Always use a positive outline-offset (e.g. 2px) to draw the focus ring outside the button when the outline color matches the button background, ensuring sufficient contrast against the app background.
