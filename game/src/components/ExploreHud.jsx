import { useEffect, useRef } from 'react';
import { useStore } from '../useStore.js';
import { UfoIcon } from './ui.jsx';
import { PauseOverlay } from './Overlays.jsx';

const BLIP = {
  u: { color: '#5ff2ff', r: 3 },   // UFO
  r: { color: '#ff9d3d', r: 3.5 }, // boost ring
  m: { color: '#c58bff', r: 7 },   // mothership
  c: { color: '#7b6f99', r: 6 },   // cleared mothership
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
      const b = BLIP[kind];
      g.globalAlpha = edge ? 0.55 : 1;
      g.fillStyle = b.color;
      g.beginPath();
      g.arc(mid + u * R, mid - v * R, b.r * 2, 0, Math.PI * 2);
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

export function ExploreHud() {
  const ex = useStore((s) => s.explore);
  const paused = useStore((s) => s.paused);
  const locked = useStore((s) => s.locked);
  if (!ex) return null;
  return (
    <section className={`hud explore${ex.scraping ? ' scrape' : ''}`}>
      <div className="hud-tl panel">
        <div className="label">UFOs found</div>
        <div className="ufo-count left">
          <UfoIcon />
          <span>{ex.ufos}</span>
        </div>
        <div className="label">Motherships</div>
        <div className="mothers">
          <b>{ex.mothers}</b> found · <b>{ex.cleared}</b> cleared
        </div>
        <div className="label">Flight time</div>
        <div className="mono">{ex.time}</div>
      </div>

      <Compass heading={ex.heading} />

      <div className="hud-tr panel radar-panel">
        <Radar blips={ex.radar} />
        <div className="radar-legend">
          <span><i style={{ background: BLIP.u.color }} />UFO</span>
          <span><i style={{ background: BLIP.r.color }} />Ring</span>
          <span><i style={{ background: BLIP.m.color }} />Mothership</span>
        </div>
      </div>

      <div className="crosshair" id="crosshair" />

      <div className="hud-bc">
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

      {!locked && !paused && <div className="lock-hint">Click to steer with the mouse</div>}
      {paused && <PauseOverlay />}
      <div className="hint">
        <span>Mouse aim · A/D turn · W/S thrust / brake</span>
        <span>Space up · Shift+S down · Shift nitro</span>
        <span>Click / F fire · Numpad 4/6/8/2 camera · 5 resets</span>
        <span>Wheel zoom · I invert Y ({ex.invert ? 'on' : 'off'}) · P pause · M mute</span>
      </div>
    </section>
  );
}
