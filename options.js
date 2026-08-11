const DEFAULTS = {
  autoRehideSeconds: 10,
  showEyeIcons: true,
  showBadge: true,
};

const autoRehideSeconds = document.getElementById("autoRehideSeconds");
const showEyeIcons = document.getElementById("showEyeIcons");
const showBadge = document.getElementById("showBadge");
const status = document.getElementById("status");

chrome.storage.sync.get(DEFAULTS, (stored) => {
  autoRehideSeconds.value = String(stored.autoRehideSeconds ?? DEFAULTS.autoRehideSeconds);
  showEyeIcons.checked = Boolean(stored.showEyeIcons);
  showBadge.checked = Boolean(stored.showBadge);
});

function save() {
  const seconds = Math.max(0, Math.min(600, Number(autoRehideSeconds.value) || 0));
  autoRehideSeconds.value = String(seconds);
  chrome.storage.sync.set(
    {
      autoRehideSeconds: seconds,
      showEyeIcons: showEyeIcons.checked,
      showBadge: showBadge.checked,
    },
    () => {
      status.textContent = "Enregistré.";
      setTimeout(() => {
        status.textContent = "";
      }, 1200);
    }
  );
}

autoRehideSeconds.addEventListener("change", save);
showEyeIcons.addEventListener("change", save);
showBadge.addEventListener("change", save);
