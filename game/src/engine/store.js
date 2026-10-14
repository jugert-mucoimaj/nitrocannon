// Minimal external store: the engine writes, React reads (via useSyncExternalStore in ../useStore.js).
// The engine publishes HUD snapshots ~20×/s so React never re-renders at frame rate.
function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set(partial) {
      state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) };
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const store = createStore({
  phase: 'loading',          // loading | menu | countdown | race | done | explore
  mode: 'race',              // what the menu will start: race | explore
  load: { loaded: 0, total: 0 },
  error: null,
  assets: null,
  engine: null,
  selected: 1,
  hud: null,                 // race HUD snapshot
  explore: null,             // explore HUD snapshot
  locked: false,             // mouse captured (pointer lock) for explore steering
  countdown: null,           // { text, go, key }
  toasts: [],                // [{ id, text, kind }]
  paused: false,
  results: null,             // { place, rows }
});
