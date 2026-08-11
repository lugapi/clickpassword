(() => {
  const ATTR = "data-clickpassword-revealed";
  const BADGE_CLASS = "clickpassword-badge";
  const EYE_CLASS = "clickpassword-eye";

  const DEFAULTS = {
    autoRehideSeconds: 10,
    showEyeIcons: true,
    showBadge: true,
  };

  /** @type {HTMLElement | null} */
  let lastTarget = null;
  /** @type {HTMLInputElement | null} */
  let lastFocusedPassword = null;
  /** @type {WeakMap<HTMLInputElement, { button: HTMLButtonElement, rehideTimer: number | null, revealed: boolean }>} */
  const controls = new WeakMap();
  /** @type {Set<HTMLInputElement>} */
  const tracked = new Set();
  /** @type {typeof DEFAULTS} */
  let settings = { ...DEFAULTS };
  /** @type {MutationObserver | null} */
  let domObserver = null;
  let scanQueued = false;
  /** Prevent double-toggle when both command + event fire */
  let lastToggleAt = 0;

  const EYE_OPEN = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 5c-5 0-9.27 3.11-11 7 1.73 3.89 6 7 11 7s9.27-3.11 11-7c-1.73-3.89-6-7-11-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 .001 6.001A3 3 0 0 0 12 9z"/></svg>`;
  const EYE_OFF = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-3.89-6-7-11-7-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 3.89 6 7 11 7 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>`;

  loadSettings();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const key of Object.keys(DEFAULTS)) {
      if (changes[key]) settings[key] = changes[key].newValue;
    }
    refreshAllUi();
  });

  document.addEventListener(
    "contextmenu",
    (event) => {
      const path = event.composedPath?.() ?? [event.target];
      lastTarget =
        path.find(
          (node) =>
            node instanceof HTMLInputElement &&
            (node.type === "password" || node.getAttribute(ATTR) === "1")
        ) ?? null;
      if (lastTarget instanceof HTMLInputElement) {
        lastFocusedPassword = lastTarget;
      }
    },
    true
  );

  // Remember password fields even after chrome.commands steals keydown/focus
  document.addEventListener(
    "focusin",
    (event) => {
      const path = event.composedPath?.() ?? [event.target];
      const input = path.find((node) => node instanceof HTMLInputElement);
      if (
        input instanceof HTMLInputElement &&
        (input.type === "password" || input.getAttribute(ATTR) === "1")
      ) {
        lastFocusedPassword = input;
        lastTarget = input;
      }
    },
    true
  );

  // Direct shortcut (when Chrome does not consume the keys)
  window.addEventListener(
    "keydown",
    (event) => {
      if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
      if (event.code !== "KeyP") return;

      const input = getToggleTarget();
      if (!input) return;

      event.preventDefault();
      event.stopPropagation();
      toggleInput(input);
    },
    true
  );

  window.addEventListener("__clickpassword_toggle_focused", () => {
    toggleFocusedCommand();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const type = message?.type;
    let result = { ok: false };

    switch (type) {
      case "CLICKPASSWORD_TOGGLE":
        result = toggleInput(resolvePasswordInput(lastTarget) ?? getToggleTarget());
        break;
      case "CLICKPASSWORD_TOGGLE_FOCUSED":
        result = toggleFocusedCommand();
        break;
      case "CLICKPASSWORD_COPY":
        result = copyPassword(
          resolvePasswordInput(lastTarget) ?? getToggleTarget()
        );
        break;
      case "CLICKPASSWORD_REVEAL_ALL":
        result = { ok: true, count: setAllRevealed(true) };
        break;
      case "CLICKPASSWORD_HIDE_ALL":
        result = { ok: true, count: setAllRevealed(false) };
        break;
      default:
        return;
    }

    sendResponse(result);
    return false;
  });

  function getToggleTarget() {
    return (
      resolvePasswordInput(getFocusedInput()) ||
      resolvePasswordInput(lastFocusedPassword) ||
      resolvePasswordInput(lastTarget)
    );
  }

  function toggleFocusedCommand() {
    const now = Date.now();
    if (now - lastToggleAt < 250) {
      return { ok: true, deduped: true };
    }
    const input = getToggleTarget();
    if (!input) return { ok: false, reason: "no-focus" };
    lastToggleAt = now;
    return toggleInput(input);
  }
  queueScan();
  observeDom();
  window.addEventListener("scroll", scheduleReposition, true);
  window.addEventListener("resize", scheduleReposition);

  function loadSettings() {
    chrome.storage.sync.get(DEFAULTS, (stored) => {
      settings = { ...DEFAULTS, ...stored };
      refreshAllUi();
    });
  }

  function getFocusedInput() {
    const active = deepActiveElement();
    return active instanceof HTMLInputElement ? active : null;
  }

  function deepActiveElement() {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) {
      el = el.shadowRoot.activeElement;
    }
    return el;
  }

  function resolvePasswordInput(el) {
    if (!(el instanceof HTMLInputElement)) return null;
    if (el.type === "password" || el.getAttribute(ATTR) === "1") return el;
    return null;
  }

  function isOurUi(node) {
    if (!(node instanceof Element)) return false;
    return (
      node.classList?.contains(EYE_CLASS) ||
      Boolean(node.closest?.("." + EYE_CLASS))
    );
  }

  function toggleInput(input) {
    if (!input) return { ok: false, reason: "not-password" };
    if (input.type === "password") {
      reveal(input);
      return { ok: true, type: "text" };
    }
    if (input.getAttribute(ATTR) === "1") {
      hide(input);
      return { ok: true, type: "password" };
    }
    return { ok: false, reason: "not-password" };
  }

  function withOwnMutations(fn) {
    domObserver?.disconnect();
    try {
      fn();
    } finally {
      // Re-attach after our DOM writes so we don't observe our own eye buttons
      if (domObserver && document.documentElement) {
        domObserver.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["type", ATTR],
        });
      }
    }
  }

  function reveal(input) {
    withOwnMutations(() => {
      if (input.type === "password") input.type = "text";
      input.setAttribute(ATTR, "1");
      ensureControl(input);
      updateControlUi(input, true);
      scheduleRehide(input);
    });
  }

  function hide(input) {
    withOwnMutations(() => {
      clearRehide(input);
      if (input.getAttribute(ATTR) === "1") {
        input.type = "password";
        input.removeAttribute(ATTR);
      }
      input.classList.remove(BADGE_CLASS);
      updateControlUi(input, true);
    });
  }

  function setAllRevealed(shouldReveal) {
    const inputs = collectPasswordInputs(document);
    for (const input of inputs) {
      if (shouldReveal) reveal(input);
      else if (input.getAttribute(ATTR) === "1") hide(input);
    }
    return inputs.length;
  }

  function copyPassword(input) {
    if (!input) return { ok: false, reason: "not-password" };
    const value = input.value ?? "";
    const ok = copyTextSync(value);
    return { ok, length: value.length };
  }

  function copyTextSync(text) {
    let ok = false;
    withOwnMutations(() => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.documentElement.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      ta.remove();
    });
    if (!ok && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
      return true;
    }
    return ok;
  }

  function scheduleRehide(input) {
    clearRehide(input);
    const seconds = Number(settings.autoRehideSeconds) || 0;
    if (seconds <= 0) return;
    const entry = controls.get(input);
    if (!entry) return;
    entry.rehideTimer = window.setTimeout(() => {
      if (input.getAttribute(ATTR) === "1") hide(input);
    }, seconds * 1000);
  }

  function clearRehide(input) {
    const entry = controls.get(input);
    if (!entry?.rehideTimer) return;
    clearTimeout(entry.rehideTimer);
    entry.rehideTimer = null;
  }

  function collectPasswordInputs(root) {
    /** @type {Set<HTMLInputElement>} */
    const results = new Set();
    walk(root, results);
    return [...results];
  }

  function walk(root, results) {
    if (!root?.querySelectorAll) return;

    // Light DOM passwords in this root
    for (const node of root.querySelectorAll('input[type="password"]')) {
      if (node instanceof HTMLInputElement) results.add(node);
    }
    for (const node of root.querySelectorAll(`input[${ATTR}="1"]`)) {
      if (node instanceof HTMLInputElement) results.add(node);
    }

    // Only descend into open shadow roots (avoid querySelectorAll("*") when possible)
    const all = root.querySelectorAll("*");
    for (const el of all) {
      if (el.shadowRoot) walk(el.shadowRoot, results);
    }
  }

  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    setTimeout(() => {
      scanQueued = false;
      scanAndAttach();
    }, 150);
  }

  function scanAndAttach() {
    withOwnMutations(() => {
      for (const input of collectPasswordInputs(document)) {
        const isNew = !controls.has(input);
        ensureControl(input);
        if (isNew) updateControlUi(input, true);
      }
      pruneDetached();
      repositionAll();
    });
  }

  function ensureControl(input) {
    if (controls.has(input)) {
      tracked.add(input);
      return;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = EYE_CLASS;
    button.tabIndex = -1;
    button.title = "Afficher / masquer le mot de passe";
    button.setAttribute("aria-label", "Afficher / masquer le mot de passe");
    button.dataset.cpOwn = "1";
    button.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleInput(input);
    });

    (document.documentElement || document.body).appendChild(button);
    controls.set(input, { button, rehideTimer: null, revealed: false });
    tracked.add(input);
  }

  function updateControlUi(input, force = false) {
    const entry = controls.get(input);
    if (!entry) return;
    const revealed = input.getAttribute(ATTR) === "1";
    const { button } = entry;

    if (force || entry.revealed !== revealed) {
      entry.revealed = revealed;
      button.innerHTML =
        (revealed ? EYE_OFF : EYE_OPEN) +
        (revealed && settings.showBadge
          ? '<span class="clickpassword-dot" aria-hidden="true"></span>'
          : "");
      button.classList.toggle("is-revealed", revealed);
    }

    button.hidden = !settings.showEyeIcons;

    if (revealed && settings.showBadge) input.classList.add(BADGE_CLASS);
    else input.classList.remove(BADGE_CLASS);

    repositionOne(input);
  }

  function refreshAllUi() {
    withOwnMutations(() => {
      for (const input of [...tracked]) {
        if (!input.isConnected) {
          removeControl(input);
          continue;
        }
        updateControlUi(input, true);
      }
    });
    queueScan();
  }

  function removeControl(input) {
    clearRehide(input);
    const entry = controls.get(input);
    entry?.button.remove();
    controls.delete(input);
    tracked.delete(input);
    input.classList.remove(BADGE_CLASS);
  }

  function pruneDetached() {
    for (const input of [...tracked]) {
      if (!input.isConnected) {
        removeControl(input);
        continue;
      }
      if (input.type !== "password" && input.getAttribute(ATTR) !== "1") {
        removeControl(input);
      }
    }
  }

  let raf = 0;
  function scheduleReposition() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      repositionAll();
    });
  }

  function repositionAll() {
    for (const input of [...tracked]) {
      if (!input.isConnected) {
        removeControl(input);
        continue;
      }
      repositionOne(input);
    }
  }

  function repositionOne(input) {
    const entry = controls.get(input);
    if (!entry || !settings.showEyeIcons) {
      if (entry) entry.button.style.display = "none";
      return;
    }
    const { button } = entry;
    const rect = input.getBoundingClientRect();
    const visible =
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth;

    if (!visible) {
      button.style.display = "none";
      return;
    }

    const size = 22;
    const top = rect.top + (rect.height - size) / 2;
    const left = rect.right - size - 4;
    button.style.display = "flex";
    button.style.top = `${Math.round(top)}px`;
    button.style.left = `${Math.round(left)}px`;
  }

  function shouldScan(mutations) {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        if (mutation.target instanceof HTMLInputElement) return true;
        continue;
      }
      for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
        if (isOurUi(node)) continue;
        if (node instanceof Element) {
          if (
            node.matches?.('input[type="password"], input[data-clickpassword-revealed="1"]') ||
            node.querySelector?.(
              'input[type="password"], input[data-clickpassword-revealed="1"]'
            )
          ) {
            return true;
          }
          if (node.shadowRoot) return true;
          // New subtree may contain inputs later; scan on element inserts
          return true;
        }
      }
    }
    return false;
  }

  function observeDom() {
    domObserver = new MutationObserver((mutations) => {
      if (!shouldScan(mutations)) return;
      queueScan();
    });

    domObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["type", ATTR],
    });
  }
})();
