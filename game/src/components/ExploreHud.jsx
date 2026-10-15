import { useEffect, useRef } from 'react';
import { useStore } from '../useStore.js';
import { UfoIcon } from './ui.jsx';
import { PauseOverlay } from './Overlays.jsx';

const BLIP = {
  u: { color: '#5ff2ff', r: 3 },   // UFO
  r: { color: '#ff9d3d', r: 3.5 }, // boost ring
  l: { color: '#ffffff', r: 4.5 }, // landmark not yet discovered
  d: { color: '#8a93a6', r: 3.5 }, // discovered landmark
  m: { color: '#c58bff', r: 7 },   // mothership
  c: { color: '#7b6f99', r: 6 },   // cleared mothership
  h: { color: '#ff3a3a', r: 7 },   // hostile mothership
  e: { color: '#ff5a4a', r: 2.5 }, // attack drone
  o: { color: '#5ff2ff', r: 4 },   // outpost (square)
  g: { color: '#ffc040', r: 6 },   // cargo destination (square)
  k: { color: '#ffd24a', r: 3.5 }, // crate waiting to be hooked
  f: { color: '#9fe8ff', r: 3.5 }, // Phoenix escort
};

/** Top-down radar, ship at the centre pointing up. Blips are pre-rotated by the engine. */
function Radar({ blips }) {
  const ref = useRef();
  useEffect(() => {
    const c = ref.current, g = c.getContext('2d');
    const S = c.width, mid = S / 2, R = mid - 10;
    g.clearRect(0, 0, S, S);
    g.strokeStyle = 'rgba(160, 210, 255, 0.22)';
    g.lineWidth = 2;
    for (const k of [1, 0.5]) {
      g.beginPath();
      g.arc(mid, mid, R * k, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(mid, mid - R);
    g.lineTo(mid, mid + R);
    g.moveTo(mid - R, mid);
    g.lineTo(mid + R, mid);
    g.stroke();
    for (const [u, v, kind, edge] of blips) {
      const b = BLIP[kind], x = mid + u * R, y = mid - v * R, s = b.r * 2;
      g.globalAlpha = edge ? 0.55 : 1;
      g.fillStyle = b.color;
      g.beginPath();
      if (kind === 'l' || kind === 'd') {
        // landmarks are diamonds
        g.moveTo(x, y - s);
        g.lineTo(x + s, y);
        g.lineTo(x, y + s);
        g.lineTo(x - s, y);
        g.closePath();
      } else if (kind === 'o' || kind === 'g') {
        g.rect(x - s * 0.8, y - s * 0.8, s * 1.6, s * 1.6); // outposts are squares
      } else {
        g.arc(x, y, s, 0, Math.PI * 2);
      }
      g.fill();
    }
    g.globalAlpha = 1;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(mid, mid - 12);
    g.lineTo(mid + 8, mid + 9);
    g.lineTo(mid - 8, mid + 9);
    g.closePath();
    g.fill();
  }, [blips]);
  return <canvas ref={ref} width={320} height={320} className="radar" />;
}

const PX_PER_DEG = 3;
const MARKS = Array.from({ length: (1080 / 15) + 1 }, (_, k) => k * 15 - 360);
const LABELS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

/** Heading tape. North = the direction the canyon runs (+Z). */
function Compass({ heading }) {
  return (
    <div className="compass">
      <div className="compass-strip" style={{ transform: `translateX(${-heading * PX_PER_DEG}px)` }}>
        {MARKS.map((d) => {
          const label = LABELS[((d % 360) + 360) % 360];
          return (
            <span key={d} className={label ? (label.length === 1 ? 'major' : 'mid') : ''} style={{ left: d * PX_PER_DEG }}>
              {label ?? '·'}
            </span>
          );
        })}
      </div>
      <i className="compass-needle" />
      <b className="compass-deg">{String(Math.round(heading) % 360).padStart(3, '0')}°</b>
    </div>
  );
}

/** Credits, the current cargo job (or the job board when you're at an outpost), and the escort's status. */
function CargoPanel({ cargo, escort }) {
  const { credits, board, job } = cargo;
  return (
    <div className="cargo panel">
      <div className="label">Credits</div>
      <div className="credits-n">
        {credits.toLocaleString()} <small>cr</small>
      </div>
      {job && (
        <div className="job">
          <div className="label">Cargo job</div>
          <b>{job.cargo}</b> → {job.to} <span className="km">{job.km} km</span>
          <div className="crate-hp">
            <i className={job.hp < 35 ? 'low' : ''}>
              <span style={{ width: `${job.hp}%` }} />
            </i>
            <em>{job.hp}%</em>
          </div>
          <p>{job.hint}</p>
          <small>
            <kbd>E</kbd> {job.state === 'carrying' ? 'release' : 'hook'} · <kbd>X</kbd> abandon · pays up to {job.reward} cr
          </small>
        </div>
      )}
      {board && (
        <div className="board">
          <div className="label">
            {board.name} · job board
          </div>
          {board.jobs.length ? (
            board.jobs.map((jb, i) => (
              <div className="board-row" key={i}>
                <kbd>{i + 1}</kbd>
                <span>
                  <b>{jb.cargo}</b> → {jb.to}
                </span>
                <span className="km">{jb.km} km</span>
                <span className="pay">{jb.reward} cr</span>
              </div>
            ))
          ) : (
            <p>No routes from here. Try another outpost.</p>
          )}
        </div>
      )}
      {escort && (
        <div className={`escort-chip ${escort.state}`}>
          {escort.state === 'ready' && (
            <>
              Phoenix escort <kbd>H</kbd> ready
            </>
          )}
          {escort.state === 'inbound' && <>Phoenix inbound…</>}
          {escort.state === 'escort' && (
            <>
              Phoenix {escort.engaged ? 'engaging' : 'on your wing'} · {escort.left}s{escort.kills ? ` · ${escort.kills} kills` : ''}
            </>
          )}
          {escort.state === 'cooldown' && <>Phoenix refuelling · {escort.left}s</>}
        </div>
      )}
    </div>
  );
}

export function ExploreHud() {
  const ex = useStore((s) => s.explore);
  const paused = useStore((s) => s.paused);
  const locked = useStore((s) => s.locked);
  if (!ex) return null;
  const t = ex.threat;
  return (
    <section className={`hud explore${ex.scraping ? ' scrape' : ''}${ex.hurt ? ' hurt' : ''}`}>
      <div className="hud-tl panel">
        <div className="label">UFOs found</div>
        <div className="ufo-count left">
          <UfoIcon />
          <span>{ex.ufos}</span>
        </div>
        <div className="label">Motherships</div>
        <div className="mothers">
          <b>{ex.mothers}</b> found · <b>{ex.cleared}</b> cleared · <b className="red">{ex.destroyed}</b> destroyed
        </div>
        <div className="label">Landmarks</div>
        <div className="mothers">
          <b>{ex.landmarks}</b> discovered
        </div>
        <div className="label">Flight time</div>
        <div className="mono">{ex.time}</div>
      </div>

      <Compass heading={ex.heading} />
      <div className="biome-label">{ex.biome}</div>

      {t && (
        <div className={`threat panel${t.exposed ? ' exposed' : ''}`}>
          {t.raid ? (
            <>
              <b>⚠ Raiders</b>
              <span>
                {t.drones} drone{t.drones === 1 ? '' : 's'} after your cargo
              </span>
            </>
          ) : t.exposed ? (
            <>
              <b>Shield down · destroy the core</b>
              <i className="core-bar">
                <span style={{ width: `${t.core * 100}%` }} />
              </i>
            </>
          ) : (
            <>
              <b>⚠ Hostile mothership</b>
              <span>
                Wave {t.wave}/{t.waves} · {t.drones} drone{t.drones === 1 ? '' : 's'} left
              </span>
            </>
          )}
        </div>
      )}

      <div className="hud-tr panel radar-panel">
        <Radar blips={ex.radar} />
        <div className="radar-legend">
          <span><i style={{ background: BLIP.u.color }} />UFO</span>
          <span><i style={{ background: BLIP.r.color }} />Ring</span>
          <span><i className="diamond" style={{ background: BLIP.l.color }} />Landmark</span>
          <span><i style={{ background: BLIP.m.color }} />Mothership</span>
          <span><i style={{ background: BLIP.h.color }} />Hostile</span>
          <span><i className="square" style={{ background: BLIP.o.color }} />Outpost</span>
        </div>
        <div className={`scan-chip${ex.scanIn ? '' : ' ready'}`}>
          Scanner <kbd>Q</kbd> {ex.scanIn ? `${ex.scanIn}s` : 'ready'}
        </div>
      </div>

      {ex.waypoints.map((w, i) => (
        <div key={i} id={`wp-${i}`} className={`waypoint ${w.kind}`}>
          <span>{w.label}</span>
          <b />
        </div>
      ))}
      {ex.cargo.job && (
        <div id="wp-job" className={`waypoint ${ex.cargo.job.state === 'carrying' ? 'j' : 'k'}`}>
          <span>{ex.cargo.job.state === 'carrying' ? ex.cargo.job.to : `${ex.cargo.job.cargo} crate`}</span>
          <b />
        </div>
      )}

      <CargoPanel cargo={ex.cargo} escort={ex.escort} />

      <div className="crosshair" id="crosshair" />

      <div className="hud-bc">
        <div className="vitals">
          <label>Shield</label>
          <i className="shield">
            <span style={{ width: `${ex.shield * 100}%` }} />
          </i>
          <label>Hull</label>
          <i className={`hull${ex.hull < 0.3 ? ' low' : ''}`}>
            <span style={{ width: `${ex.hull * 100}%` }} />
          </i>
        </div>
        <div className="speed">
          {ex.speed}
          <small>km/h</small>
        </div>
        <div className="alt">
          ALT <b>{ex.alt}</b> m
          {Math.abs(ex.lift) > 2 && (
            <span className={`vs ${ex.lift > 0 ? 'up' : 'down'}`}>
              {ex.lift > 0 ? '▲' : '▼'} {Math.abs(ex.lift)} m/s
            </span>
          )}
        </div>
        <div className={`nitro${ex.nitroActive ? ' active' : ''}${ex.nitro < 0.05 ? ' empty' : ''}`}>
          <div className="nitro-fill" style={{ width: `${ex.nitro * 100}%` }} />
        </div>
        <div className="nitro-label">
          Nitro <kbd>Shift</kbd> · UFOs refill it · rings boost
        </div>
      </div>

      {ex.disabled && (
        <div className="disabled">
          Ship disabled
          <small>Respawning out of range…</small>
        </div>
      )}
      {!locked && !paused && !ex.disabled && <div className="lock-hint">Click to steer with the mouse</div>}
      {paused && <PauseOverlay />}
      <div className="hint">
        <span>Mouse aim · A/D turn · W/S thrust / brake</span>
        <span>Space up · Shift+S down · Shift nitro</span>
        <span>Click / F fire · Q scan · Numpad 4/6/8/2 camera</span>
        <span>E hook · 1-3 take a job · X drop it{ex.escort ? ' · H escort' : ''}</span>
        <span>Wheel zoom · I invert Y ({ex.invert ? 'on' : 'off'}) · P pause · M mute</span>
      </div>
    </section>
  );
}
