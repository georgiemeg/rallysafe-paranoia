try {
  localStorage.removeItem("poker:saved-game:v1");
} catch {
  /* ignore */
}

const params = new URLSearchParams(location.search);
const name = (params.get("name") || "Player").trim().slice(0, 24) || "Player";

const seats = Array.from(document.querySelectorAll(".seat"));
seats.forEach((seat, i) => {
  const close = seat.querySelector(".close");
  const rotate = seat.querySelector(".rotate");
  if (close) close.remove();
  if (rotate) rotate.remove();
  const h3 = seat.querySelector("h3");
  if (h3) {
    h3.removeAttribute("contenteditable");
    h3.textContent = "";
  }
  if (![0, 2, 4].includes(i)) seat.classList.add("hidden");
});

if (seats[4]) {
  const h3 = seats[4].querySelector("h3");
  if (h3) h3.textContent = name;
}

const notice = document.querySelector("#notification");
if (notice) {
  notice.textContent = "Best of three. You are in the middle.";
}

function fitTable() {
  document.body.style.zoom = "1";
  const footer = document.querySelector("footer");
  const main = document.querySelector("main");
  const need = (main?.scrollHeight || 0) + (footer?.offsetHeight || 0) + 12;
  const avail = window.innerHeight;
  const s = avail / Math.max(need, 1);
  document.body.style.zoom = String(Math.min(0.92, Math.max(0.62, s)));
}

fitTable();
window.addEventListener("resize", fitTable);

const start = document.querySelector("#start-button");
if (start) start.click();
setTimeout(fitTable, 50);

function human() {
  const players = globalThis.poker?.players;
  if (!Array.isArray(players)) return null;
  return players.find((p) => p && p.isBot !== true) || null;
}

let matchSent = false;
function endMatch(win) {
  if (matchSent) return;
  matchSent = true;
  document.querySelector("#new-round-cancel-button")?.click();
  document.querySelector("#start-button")?.classList.add("hidden");
  window.parent?.postMessage({ type: "paranoia-poker", win }, "*");
}

setInterval(() => {
  if (matchSent) return;
  const h = human();
  if (!h) return;
  const hands = Number(h.stats?.hands || 0);
  const won = Number(h.stats?.handsWon || 0);
  const lost = Math.max(0, hands - won);
  const busted = Number(h.chips || 0) <= 0;
  const finished = globalThis.poker?.gameFinished === true;
  if (won >= 2) endMatch(true);
  else if (lost >= 2 || (busted && won < 2) || (finished && won < 2) || (hands >= 3 && won < 2)) endMatch(false);
  fitTable();
}, 400);
