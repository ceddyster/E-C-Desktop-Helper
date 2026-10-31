/* Optional: direct Google Drive picking.
 *
 * You do NOT need this to use the dashboard. The "Load documents" button already
 * lets you pick files from your G: drive (Google Drive for Desktop) like any folder.
 *
 * Fill these in only if you want the "Google Drive" button too — e.g. because your
 * rosters are native Google Sheets (those show up on G: as .gsheet shortcuts that
 * can't be read directly). See README.md → "Optional: Google Drive button".
 */
window.CROWN_CONFIG = {
  googleApiKey: '',     // Browser API key (Google Cloud → APIs & Services → Credentials)
  googleClientId: '',   // OAuth 2.0 Web client ID, e.g. 1234-abc.apps.googleusercontent.com
  googleAppId: '',      // Google Cloud project NUMBER (digits only)
};
