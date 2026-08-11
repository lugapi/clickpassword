const MENU_ID = "clickpassword-toggle";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Afficher / masquer le mot de passe",
      contexts: ["editable"],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;

  chrome.tabs.sendMessage(
    tab.id,
    { type: "CLICKPASSWORD_TOGGLE" },
    { frameId: info.frameId },
    () => {
      // Ignore errors on pages without the content script (chrome://, etc.)
      void chrome.runtime.lastError;
    }
  );
});
