// Links for Mars browser.

/** A page of the website, tagged with the place that links to it. */
export const websiteUrl = (path: '/' | '/docs', place: 'side-panel' | 'settings' | 'about') =>
  `#${path}?utm_source=mars-extension&utm_medium=${place}`;
