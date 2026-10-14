// Small shared UI bits.
export const Title = () => (
  <h1 className="title">
    NITRO<span>CANYON</span>
  </h1>
);

export const ordinal = (n) => (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');

export const UfoIcon = () => (
  <svg viewBox="0 0 40 22" aria-hidden="true">
    <path d="M11 13 Q20 -2 29 13" fill="#7f9cff" />
    <ellipse cx="20" cy="15" rx="19" ry="5.5" fill="#1d2a44" stroke="#5ff2ff" strokeWidth="1.5" />
    <circle cx="9" cy="15.5" r="1.4" fill="#ffd27a" />
    <circle cx="20" cy="17" r="1.4" fill="#ffd27a" />
    <circle cx="31" cy="15.5" r="1.4" fill="#ffd27a" />
  </svg>
);

/** Run an engine action from a button and drop focus, so Enter/Space go back to the game. */
export const press = (fn) => (e) => {
  e.currentTarget.blur();
  fn();
};
