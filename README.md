# Store Login

Home Assistant app that lets you log in to a supermarket **in a browser inside Home Assistant** and gives you the token that the **Store Receipts** integration needs.

## How to use

1. Install and start the app, then open it from the sidebar (*Open Web UI*).
2. Choose a store. A temporary browser opens in the page. Tap fields to type, tap to click, drag to scroll, and use **← Back** to go back a page.
3. Log in like you normally would (including captchas and verification codes).
4. When the login succeeds you get a token. Copy it.
5. In Home Assistant: *Settings → Devices & services → Add integration → Store Receipts*, choose the same store and paste the token in **Refresh token**.

Use each token only once: some stores replace it when it is first used.

## Good to know

- The browser session is temporary. It closes after the login, when you press **Stop**, or after 5 minutes.
- **Action** does not give a short code but a longer text with your session cookies. It only works for the IP address and browser identity used here, so Home Assistant and the add-on must be on the same network.
- The interface is available in English and Dutch (it follows your browser language).

## Notes

Unofficial. Not affiliated with any of the stores. Your password is typed into the store's own login page in the temporary browser; Home Assistant only receives the token.

See the [Store Receipts integration](https://github.com/Xornop/ha-store-receipts) for installation and the manual alternative.
