(() => {
  let lastTarget = null;

  document.addEventListener(
    "contextmenu",
    (event) => {
      const el = event.target;
      if (el instanceof HTMLInputElement) {
        lastTarget = el;
      } else {
        lastTarget = null;
      }
    },
    true
  );

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "CLICKPASSWORD_TOGGLE") return;

    const input = resolvePasswordInput(lastTarget);
    if (!input) {
      sendResponse({ ok: false, reason: "not-password" });
      return;
    }

    if (input.type === "password") {
      input.type = "text";
      input.dataset.clickpasswordRevealed = "1";
    } else if (input.dataset.clickpasswordRevealed === "1") {
      input.type = "password";
      delete input.dataset.clickpasswordRevealed;
    } else {
      sendResponse({ ok: false, reason: "not-password" });
      return;
    }

    sendResponse({ ok: true, type: input.type });
  });

  function resolvePasswordInput(el) {
    if (!(el instanceof HTMLInputElement)) return null;

    if (el.type === "password" || el.dataset.clickpasswordRevealed === "1") {
      return el;
    }

    return null;
  }
})();
