import { SHIPS, EXPLORE_SHIPS, CREDITS, cssColor } from '../engine/config.js';
import { store } from '../engine/store.js';
import { useStore } from '../useStore.js';
import { Title, UfoIcon, ordinal, press } from './ui.jsx';

export function Loading() {
  const { loaded, total } = useStore((s) => s.load);
  const error = useStore((s) => s.error);
  const pct = total ? loaded / total : 0;
  let text = 'Loading ships…';
  if (error) text = `Couldn't load the models: ${error}`;
  else if (total && loaded >= total) text = 'Building the canyon…';
  else if (total) text = `Loading ships… ${(loaded / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB`;
  return (
    <section className="overlay loading">
      <div className="loading-box">
        <Title />
        <div className="bar">
          <div style={{ width: `${(pct * 100).toFixed(1)}%` }} />
        </div>
        <p className={error ? 'error' : ''}>{text}</p>
      </div>
    </section>
  );
}

const STATS = [
  ['Top speed', 'speed'],
  ['Acceleration', 'accel'],
  ['Handling', 'handling'],
  ['Nitro tank', 'nitro'],
];
const statPct = (v) => Math.round(Math.min(1, Math.max(0.05, (v - 0.8) / 0.5)) * 100);

const MODES = [
  { id: 'race', name: 'Race', blurb: '15 km canyon sprint against two armed rivals' },
  { id: 'explore', name: 'Explore', blurb: 'Open world · biomes, landmarks, cargo runs, rare UFOs' },
];

// Both modes fly the same way.
const CONTROLS = [
  [['Mouse'], 'aim'],
  [['W', 'S'], 'thrust / brake'],
  [['A', 'D'], 'turn'],
  [['Space'], 'up'],
  [['Shift+S'], 'down'],
  [['Shift'], 'nitro'],
  [['Click', 'F'], 'lasers'],
  [['Q'], 'scan (explore)'],
  [['E'], 'cargo hook (explore)'],
  [['Num 4 6 8 2'], 'camera'],
];

/** Pause screen with real buttons: the mouse is released while paused, so it needs to be clickable. */
export function PauseOverlay() {
  const engine = useStore((s) => s.engine);
  return (
    <div className="pause interactive">
      Paused
      <small>Mouse released · Resume to keep flying</small>
      <div className="menu-actions">
        <button className="btn" onClick={press(() => engine?.resume())}>
          Resume <kbd>Enter</kbd>
        </button>
        <button className="btn ghost" onClick={press(() => engine?.enterMenu())}>
          Menu <kbd>Esc</kbd>
        </button>
      </div>
    </div>
  );
}

export function Menu() {
  const selected = useStore((s) => s.selected);
  const mode = useStore((s) => s.mode);
  const engine = useStore((s) => s.engine);
  const ships = mode === 'explore' ? EXPLORE_SHIPS : SHIPS;
  return (
    <section className="overlay menu">
      <header className="menu-head">
        <Title />
        <p className="subtitle">
          {mode === 'race'
            ? '15 km canyon sprint · the speed cap keeps climbing · blast rivals, spires and UFOs'
            : 'Endless open world · four biomes · landmarks, motherships, rare UFOs and cargo runs between outposts'}
        </p>
      </header>
      <div className="menu-foot">
        <div className="modes">
          {MODES.map((m) => (
            <button key={m.id} className={`mode${m.id === mode ? ' on' : ''}`} onClick={press(() => engine?.setMode(m.id))}>
              <b>{m.name}</b>
              <span>{m.blurb}</span>
            </button>
          ))}
          <span className="modes-hint">
            <kbd>Tab</kbd> switch
          </span>
        </div>
        <div className={`cards${ships.length > 3 ? ' four' : ''}`}>
          {ships.map((s, i) => (
            <button
              key={s.id}
              className={`card${i === selected ? ' selected' : ''}`}
              style={{ '--accent': cssColor(s.flame) }}
              onClick={press(() => engine?.selectShip(i))}
              onDoubleClick={() => engine?.start()}
            >
              <div className="card-head">
                <span className="card-name">{s.name}</span>
                <span className="card-tag">{s.tag}</span>
              </div>
              <p className="card-blurb">{s.blurb}</p>
              {STATS.map(([label, key]) => (
                <div className="stat" key={key}>
                  <span>{label}</span>
                  <i>
                    <b style={{ width: `${statPct(s.stats[key])}%` }} />
                  </i>
                </div>
              ))}
            </button>
          ))}
        </div>
        <div className="menu-actions">
          <button className="btn" onClick={press(() => engine?.start())}>
            {mode === 'race' ? 'Race' : 'Explore'} <kbd>Enter</kbd>
          </button>
          <ul className="controls">
            {CONTROLS.map(([keys, action]) => (
              <li key={action}>
                {keys.map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}{' '}
                {action}
              </li>
            ))}
          </ul>
        </div>
        <p className="credits">
          3D models from Sketchfab, modified:{' '}
          {CREDITS.map((c, i) => (
            <span key={c.url}>
              {i > 0 && ' · '}
              <a href={c.url} target="_blank" rel="noopener noreferrer">{c.short}</a> by{' '}
              <a href={c.authorUrl} target="_blank" rel="noopener noreferrer">{c.author}</a> (
              <a href={c.licenseUrl} target="_blank" rel="noopener noreferrer">{c.license}</a>)
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}

export function Hud() {
  const hud = useStore((s) => s.hud);
  const countdown = useStore((s) => s.countdown);
  const paused = useStore((s) => s.paused);
  const locked = useStore((s) => s.locked);
  if (!hud) return null;
  return (
    <section className={`hud${hud.scraping ? ' scrape' : ''}`}>
      <div className="hud-tl panel">
        <div className="label">Position</div>
        <div className="pos">
          {hud.place}
          <sup>{ordinal(hud.place)}</sup>
          <span className="of">/{hud.total}</span>
        </div>
        <div className="label">Time</div>
        <div className="mono">{hud.time}</div>
      </div>

      <div className="hud-tc">
        <div className="track">
          <div className="track-fill" style={{ width: `${hud.progress * 100}%` }} />
          {hud.racers.map((r) => (
            <i key={r.id} className={`dot${r.me ? ' me' : ''}`} title={r.name} style={{ left: `${r.t * 100}%`, background: r.color }} />
          ))}
          <div className="flag" />
        </div>
        <div className="dist">
          <span>{hud.distLeft}</span> km to finish
        </div>
      </div>

      <div className="hud-tr panel">
        <div className="label">UFOs</div>
        <div className="ufo-count">
          <UfoIcon />
          <span>{hud.ufos}</span>
        </div>
        <div className="label">Laser hits</div>
        <div className="hits">{hud.hits}</div>
      </div>

      {hud.manual && <div className="crosshair" id="crosshair" />}

      <div className="hud-bc">
        <div className="speed">
          {hud.speed}
          <small>km/h</small>
        </div>
        <div className={`nitro${hud.nitroActive ? ' active' : ''}${hud.nitro < 0.05 ? ' empty' : ''}`}>
          <div className="nitro-fill" style={{ width: `${hud.nitro * 100}%` }} />
        </div>
        <div className="nitro-label">
          Nitro <kbd>Shift</kbd> · UFOs refill it · rings boost
        </div>
      </div>

      {countdown && (
        <div key={countdown.key} className={`countdown${countdown.go ? ' go' : ''}`}>
          {countdown.text}
        </div>
      )}
      {hud.manual && !locked && !paused && <div className="lock-hint">Click to steer with the mouse</div>}
      {paused && <PauseOverlay />}
      <div className="hint">
        <span>Mouse aim · A/D turn · W/S thrust / brake</span>
        <span>Space up · Shift+S down · Shift nitro</span>
        <span>Click / F fire · Numpad 4/6/8/2 camera · 5 resets</span>
        <span>I invert Y ({hud.invert ? 'on' : 'off'}) · P pause · M mute · R restart</span>
      </div>
    </section>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const remove = (id) => store.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onAnimationEnd={() => remove(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Results() {
  const results = useStore((s) => s.results);
  const engine = useStore((s) => s.engine);
  if (!results) return null;
  const { place, rows } = results;
  return (
    <section className="overlay results">
      <div className="results-box panel">
        <h2>{place === 1 ? 'Victory! 1st place' : `${place}${ordinal(place)} place`}</h2>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Ship</th>
              <th>Time</th>
              <th>Top speed</th>
              <th>Hits</th>
              <th>UFOs</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.me ? 'me' : ''}>
                <td>{r.place}</td>
                <td>
                  <i className="dot" style={{ background: r.color }} />
                  {r.name}
                  {r.me && <em>you</em>}
                </td>
                <td>{r.time ?? 'racing…'}</td>
                <td>{r.top} km/h</td>
                <td>{r.hits}</td>
                <td>{r.ufos ?? '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="menu-actions">
          <button className="btn" onClick={press(() => engine?.startRace())}>
            Race again <kbd>Enter</kbd>
          </button>
          <button className="btn ghost" onClick={press(() => engine?.enterMenu())}>
            Change ship <kbd>Esc</kbd>
          </button>
        </div>
      </div>
    </section>
  );
}
