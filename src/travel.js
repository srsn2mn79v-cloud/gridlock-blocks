// Travelling between cities. Only one city is ever built and held in memory (each is big); going to another one restarts the
// game in that city, as the airport and the old Marin gate always did. What this module adds is the hand-over: where you are
// going, how fast, the time of day and the radio station are kept across the restart, and a tunnel is drawn over the screen from the
// moment you enter the tunnel mouth in one city until you are rolling out of the tunnel mouth in the other.
// The tunnel is plain HTML moved by CSS transform animations (index.html), which the browser runs off the main thread, so it
// keeps moving while the next city is being built.
const KEY = 'gridlock-travel';

// state: anything small and JSON-safe (see main.js). `to` is the city id stored as `gridlock-city`.
export function beginTravel(to, state, label) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ ...state, to, t: Date.now() })); localStorage.setItem('gridlock-city', to); } catch (e) { /* storage blocked: the city still changes */ }
  const tx = document.getElementById('tunnelText'); if (tx && label) tx.textContent = label;
  document.documentElement.classList.add('travel');
  setTimeout(() => {
    const u = new URL(location.href);
    if (u.searchParams.has('city')) { u.searchParams.delete('city'); location.replace(u.toString()); } else location.reload();
  }, 900);                                                      // long enough for the tunnel to have faded in over the old city
}

// The hand-over left by beginTravel, once (null on a normal start, or if it is stale or meant for another city).
export function takeArrival(cityId) {
  let a = null;
  try { const raw = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY); if (raw) a = JSON.parse(raw); } catch (e) { /* ignore */ }
  if (!a || a.to !== cityId || Date.now() - (a.t || 0) > 120000) return null;
  return a;
}

// Lift the tunnel off the screen (it fades out; see index.html).
export function endTravel() {
  const h = document.documentElement;
  if (!h.classList.contains('travel')) return;
  h.classList.add('travel-out');
  setTimeout(() => { h.classList.remove('travel', 'travel-out'); }, 1400);
}
