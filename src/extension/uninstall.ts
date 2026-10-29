// The page Chrome opens after Mars is removed.
export const UNINSTALL_FORM = '';

/** Sets the page at worker start. */
export function setUninstallPage(): void {
  if (!UNINSTALL_FORM) return;
  void chrome.runtime.setUninstallURL(UNINSTALL_FORM).catch(error => console.error('[uninstall] page not set', error));
}
