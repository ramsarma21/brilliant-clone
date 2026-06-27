// A looping ambient stadium behind the app.
//  - variant="menu": a CINEMATIC, following-camera movie (FIFA-style). The camera
//    tracks a foreground player who passes to a teammate; the teammate receives,
//    dribbles past two defenders, shoots and SCORES, then slides on his knees as
//    the crowd erupts. Letterbox bars + vignette + punch-in zooms sell the film.
//  - variant="app": a calmer green pitch with a keeper + jogging players, behind
//    the dashboard.
// Pure SVG + CSS so it stays cheap and fully restyleable.

type Kit = { jersey: string; shorts: string; skin: string; sleeve: string }

const HOME: Kit = { jersey: '#7c5cff', shorts: '#ffffff', skin: '#e8b48a', sleeve: '#a35bff' }
const AWAY: Kit = { jersey: '#ff2d55', shorts: '#10131c', skin: '#b87a45', sleeve: '#ff5b7a' }
const KEEP: Kit = { jersey: '#ffd166', shorts: '#0c1228', skin: '#e8b48a', sleeve: '#f4b63c' }

// A stylised footballer mirroring the in-sim characters: skin head + dark hair,
// kit jersey with sleeves + a back number, shorts, skin legs + dark boots.
function Runner({ kit, num, faceCamera }: { kit: Kit; num?: number; faceCamera?: boolean }) {
  return (
    <svg className="runner__svg" viewBox="0 0 44 76">
      <ellipse className="runner__shadow" cx="22" cy="73" rx="14" ry="3.2" />
      <g className="runner__legs">
        <g className="runner__leg runner__leg--l">
          <rect x="15" y="45" width="6.5" height="21" rx="3" fill={kit.skin} />
          <rect x="13" y="64" width="11" height="6" rx="3" fill="#15171f" />
        </g>
        <g className="runner__leg runner__leg--r">
          <rect x="22.5" y="45" width="6.5" height="21" rx="3" fill={kit.skin} />
          <rect x="20" y="64" width="11" height="6" rx="3" fill="#15171f" />
        </g>
      </g>
      <rect x="13.5" y="39" width="17" height="12" rx="3" fill={kit.shorts} />
      <rect x="13.5" y="39" width="17" height="4" rx="2" fill="#000" opacity="0.12" />
      <g className="runner__arms">
        <g className="runner__arm runner__arm--l">
          <rect x="8.5" y="22" width="6" height="13" rx="3" fill={kit.sleeve} />
          <rect x="8.5" y="33" width="6" height="9" rx="3" fill={kit.skin} />
        </g>
        <g className="runner__arm runner__arm--r">
          <rect x="29.5" y="22" width="6" height="13" rx="3" fill={kit.sleeve} />
          <rect x="29.5" y="33" width="6" height="9" rx="3" fill={kit.skin} />
        </g>
      </g>
      <rect x="11.5" y="19" width="21" height="25" rx="6" fill={kit.jersey} />
      <rect x="11.5" y="19" width="21" height="6.5" rx="4" fill={kit.sleeve} opacity="0.6" />
      <rect x="11.5" y="34" width="21" height="10" rx="4" fill="#000" opacity="0.1" />
      {num != null && (
        <text x="22" y="35" textAnchor="middle" fontFamily="'Plus Jakarta Sans', sans-serif"
          fontSize="11" fontWeight="800" fill="#fff">{num}</text>
      )}
      <circle cx="22" cy="12.5" r="8.2" fill={kit.skin} />
      {faceCamera ? (
        <>
          <path d="M13.8 9 a8.2 8.2 0 0 1 16.4 0 q-8.2 -6 -16.4 0Z" fill="#241c2b" />
          <circle cx="18.8" cy="13" r="1.1" fill="#241c2b" />
          <circle cx="25.2" cy="13" r="1.1" fill="#241c2b" />
        </>
      ) : (
        <path d="M13.8 11.5 a8.2 8.2 0 0 1 16.4 0 q-8.2 -7.5 -16.4 0Z" fill="#241c2b" />
      )}
    </svg>
  )
}

function BallSvg() {
  return (
    <svg viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="46" fill="#fff" stroke="#10131c" strokeWidth="4" />
      <polygon points="50,30 64,40 59,57 41,57 36,40" fill="#10131c" />
      <polygon points="50,5 58,19 50,28 42,19" fill="#10131c" />
      <polygon points="92,40 84,56 72,49 76,34" fill="#10131c" />
    </svg>
  )
}

function CinematicMovie() {
  return (
    <>
      <div className="cine__cam">
        {/* floodlight glows (fixed to frame, behind everything) */}
        <span className="cine__flood cine__flood--l" />
        <span className="cine__flood cine__flood--r" />

        {/* far parallax layer: sky, stands, crowd (depth-blurred) */}
        <div className="cine__far">
          <div className="cine__sky" />
          <div className="cine__stands">
            <span className="cine__crowd" />
            <span className="cine__crowdflash" />
          </div>
        </div>

        {/* near world: the pitch + the action, panned by the follow camera */}
        <div className="cine__world">
          <div className="cine__ground">
            <span className="cine__stripes" />
            <span className="cine__sideline" />
          </div>

          <div className="cine__goal">
            <span className="cine__bar" />
            <span className="cine__post cine__post--l" />
            <span className="cine__post cine__post--r" />
            <span className="cine__net" />
          </div>
          <div className="cine__keeper"><Runner kit={KEEP} num={1} faceCamera /></div>

          <div className="cine__defender cine__defender--1"><Runner kit={AWAY} num={5} faceCamera /></div>
          <div className="cine__defender cine__defender--2"><Runner kit={AWAY} num={6} faceCamera /></div>

          {/* foreground "you" — the passer the camera starts on */}
          <div className="cine__you"><Runner kit={HOME} num={8} /></div>
          {/* the teammate who receives, dribbles, scores + wheels away running */}
          <div className="cine__scorer"><Runner kit={HOME} num={10} faceCamera /></div>

          <div className="cine__ball"><BallSvg /></div>
        </div>
      </div>

      {/* full-frame fx (not panned) */}
      <div className="cine__fx">
        <span className="cine__flash" />
        <div className="cine__confetti">
          {Array.from({ length: 18 }).map((_, i) => (
            <span key={i} className={`cine__confetto cine__confetto--${(i % 4) + 1}`} style={{ left: `${3 + i * 5.4}%` }} />
          ))}
        </div>
        <div className="cine__goaltext">GOAL!</div>
      </div>

      {/* film treatment (vignette only — no letterbox bars) */}
      <div className="cine__vignette" />
      <div className="cine__lower">PHYSICS FC · MATCHDAY</div>
    </>
  )
}

function AmbientPlayers() {
  return (
    <div className="pitchbg__players">
      <div className="pitchbg__keeper"><Runner kit={KEEP} num={1} /></div>
      <div className="pitchbg__runner pitchbg__runner--1"><Runner kit={HOME} num={10} /></div>
      <div className="pitchbg__runner pitchbg__runner--2"><Runner kit={AWAY} num={4} /></div>
      <div className="pitchbg__runner pitchbg__runner--3"><Runner kit={HOME} num={7} /></div>
      <div className="pitchbg__runner pitchbg__runner--4"><Runner kit={AWAY} num={6} /></div>
      <div className="pitchbg__ball pitchbg__ball--amb"><BallSvg /></div>
    </div>
  )
}

export function PitchBackground({ variant = 'app' }: { variant?: 'menu' | 'app' }) {
  if (variant === 'menu') {
    return (
      <div className="pitchbg pitchbg--cine" aria-hidden>
        <CinematicMovie />
      </div>
    )
  }
  return (
    <div className="pitchbg pitchbg--app" aria-hidden>
      <div className="pitchbg__sky" />
      <div className="pitchbg__floods">
        <span className="pitchbg__flood pitchbg__flood--l" />
        <span className="pitchbg__flood pitchbg__flood--r" />
        <span className="pitchbg__beam" />
      </div>
      <div className="pitchbg__stands">
        <span className="pitchbg__crowd" />
        <span className="pitchbg__tier" />
      </div>
      <div className="pitchbg__field">
        <div className="pitchbg__stripes" />
        <div className="pitchbg__lines">
          <span className="pitchbg__halfway" />
          <span className="pitchbg__circle" />
          <span className="pitchbg__spot" />
          <span className="pitchbg__box pitchbg__box--l" />
          <span className="pitchbg__box pitchbg__box--r" />
        </div>
        <div className="pitchbg__goal"><div className="pitchbg__goal-net" /></div>
      </div>
      <AmbientPlayers />
      <div className="pitchbg__veil" />
    </div>
  )
}
