const MENU = {
  TOGGLE: "clickpassword-toggle",
  COPY: "clickpassword-copy",
  REVEAL_ALL: "clickpassword-reveal-all",
  HIDE_ALL: "clickpassword-hide-all",
};

const DEFAULTS = {
  autoRehideSeconds: 10,
  showEyeIcons: true,
  showBadge: true,
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(DEFAULTS, (stored) => {
    chrome.storage.sync.set({ ...DEFAULTS, ...stored });
  });
  rebuildMenus();
});

chrome.runtime.onStartup.addListener(rebuildMenus);

function rebuildMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU.TOGGLE,
      title: "Afficher / masquer le mot de passe",
      contexts: ["editable"],
    });
    chrome.contextMenus.create({
      id: MENU.COPY,
      title: "Copier le mot de passe",
      contexts: ["editable"],
    });
    chrome.contextMenus.create({
      id: MENU.REVEAL_ALL,
      title: "Afficher tous les mots de passe",
      contexts: ["page", "editable", "frame"],
    });
    chrome.contextMenus.create({
      id: MENU.HIDE_ALL,
      title: "Masquer tous les mots de passe",
      contexts: ["page", "editable", "frame"],
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  switch (info.menuItemId) {
    case MENU.TOGGLE:
      await sendToFrame(tab.id, info.frameId ?? 0, { type: "CLICKPASSWORD_TOGGLE" });
      break;
    case MENU.COPY:
      await sendToFrame(tab.id, info.frameId ?? 0, { type: "CLICKPASSWORD_COPY" });
      break;
    case MENU.REVEAL_ALL:
      await broadcast(tab.id, { type: "CLICKPASSWORD_REVEAL_ALL" });
      break;
    case MENU.HIDE_ALL:
      await broadcast(tab.id, { type: "CLICKPASSWORD_HIDE_ALL" });
      break;
    default:
      break;
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "toggle-password") return;
  const target =
    tab ??
    (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!target?.id) return;
  await toggleFocused(target.id);
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  await broadcast(tab.id, { type: "CLICKPASSWORD_REVEAL_ALL" });
});

async function toggleFocused(tabId) {
  // 1) Ask content scripts (they remember the last focused password)
  await broadcast(tabId, { type: "CLICKPASSWORD_TOGGLE_FOCUSED" });

  // 2) Also poke each frame via executeScript (works even if sendMessage fails)
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        window.dispatchEvent(new CustomEvent("__clickpassword_toggle_focused"));
      },
    });
  } catch {
    // Restricted page (chrome://, Web Store, PDF, …)
  }
}

async function sendToFrame(tabId, frameId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message, { frameId });
  } catch {
    // No content script in this frame
  }
}

async function broadcast(tabId, message) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (!frames?.length) {
      await sendToFrame(tabId, 0, message);
      return;
    }
    await Promise.all(
      frames.map((frame) => sendToFrame(tabId, frame.frameId, message))
    );
  } catch {
    await sendToFrame(tabId, 0, message);
  }
}
