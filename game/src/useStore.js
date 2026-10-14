import { useSyncExternalStore } from 'react';
import { store } from './engine/store.js';

/** Subscribe a component to one slice of the game store. Selectors must return stable values. */
export const useStore = (selector) => useSyncExternalStore(store.subscribe, () => selector(store.get()));
