// Central tuning for the 5v5 match. All distances in metres, time in seconds.
// The pitch lies on X (width) / Z (length); goals are at the two Z ends.

export const FIELD = {
  HALF_W: 21, // pitch is 42 m wide  (x in [-21, 21])
  HALF_L: 32, // pitch is 64 m long  (z in [-32, 32]) — 7-a-side, room to play
  GOAL_HALF_W: 3.0, // 6 m wide goal mouth (rewards placement over luck)
  GOAL_H: 2.6, // goal height
  GOAL_DEPTH: 1.8,
  BOX_HALF_W: 11, // penalty-area half width
  BOX_DEPTH: 12, // penalty-area depth from the goal line
  WALL_PAD: 1.0, // players are kept this far inside the touchline
}

export const BALL = {
  R: 0.22,
  GRAVITY: 15, // m/s^2 (a touch punchy so lobs read well)
  GROUND_FRICTION: 9.5, // rolling decel on the turf (m/s^2) — loose balls settle quickly
  AIR_DRAG: 0.08, // per second velocity damping in flight
  BOUNCE: 0.5, // vertical restitution
  CONTROL_R: 1.4, // a loose ball within this of a player can be brought under control
  DRIBBLE_AHEAD: 0.5, // how far in front of the feet the dribbled ball sits (hugs the feet)
  TAKE_COOLDOWN: 0.38, // s after a kick before anyone (incl. the kicker) can re-own it (lets passes travel out of the scrum)
  MAX_SPEED: 30, // shots can be punchy; passes stay slow via their own speeds
  SHOT_SPEED_THRESHOLD: 9, // above this a ball counts as a "shot" the GK must actually save
  // ---- Magnus / spin (real curve) ----
  // Lateral accel ≈ MAGNUS · |spin| · speed, perpendicular to travel. Over a flight of T
  // seconds the bend ≈ ½·a·T². Tuned so a ~15 m/s finesse (spin≈8) bends ~1.5 m over ~1 s.
  MAGNUS: 0.028,
  SPIN_DECAY: 0.6, // /s — the bend tapers late in flight, like a real ball
  SPIN_WOBBLE: 1.4, // base random side-spin on any kick (replaces the old cosmetic wobble)
  // ---- Body blocks (shots/passes deflect off players) ----
  BLOCK_HEIGHT: 1.45, // a ball below this height can be blocked by a body/leg (lofted balls sail over)
  BLOCK_FAST: 9, // at/above this speed a blocked ball deflects; slower → it's an interception
  BLOCK_DAMP: 0.6, // pace kept after a deflection
  BLOCK_SCATTER: 0.5, // rad of random scatter on a deflection (chaotic but fair)
}

export const PLAYER = {
  RADIUS: 0.55, // soft-body radius for separation
  BASE_SPEED: 6.0, // m/s at pace ~50
  SPRINT_MULT: 1.34,
  ACCEL: 30, // m/s^2 baseline ground acceleration (per-player accel overrides this — see ARCH)
  TURN_RATE: 13, // rad/s facing turn
  HEIGHT: 1.82,
}

// AcceleRATE-style acceleration archetypes. A player's burst vs flat-out speed is derived
// from pace vs an agility proxy (dribbling): explosive = quick off the mark but lower top
// speed; lengthy = slow to wind up but quicker flat-out; controlled = balanced.
export const ARCH = {
  ACCEL_MIN: 19, // m/s^2 (lengthy)
  ACCEL_MAX: 40, // m/s^2 (explosive)
  TOP_MIN: 0.97, // top-speed multiplier (explosive trades a little top end)
  TOP_MAX: 1.07, // (lengthy pull away late)
  EXPLOSIVE_GAP: 0.14, // q(dribbling) - q(pace) above this → explosive
  LENGTHY_GAP: -0.14, // below this → lengthy
}

export const MATCH = {
  HALF_SECONDS: 120, // real seconds per half (4-minute match) shown as 0->45->90'
  KICKOFF_FREEZE: 1.1, // settle time on kickoff before the ball is live
  GOAL_CELEBRATE: 4.2, // s the goal celebration runs (team mobs the scorer / dances)
  RESTART_FREEZE: 0.7,
  OUT_PAUSE: 1.1, // s the ball is shown dead where it went out before the restart is set up
}

// Fixed simulation timestep (the sim advances in these increments regardless of FPS).
export const DT = 1 / 60
export const MAX_FRAME_DT = 0.05 // clamp huge tab-stall deltas

// ---- Controls (keyboard). Movement is camera-relative (you always attack "up"). ----
// WASD move. Hold ↑ while moving = SPRINT. Hold SHIFT = the "L2/LT" modifier.
// CARRY:   Space = pass (hold to loft/cross) · E = through ball · Q = shoot (hold to power;
//          full charge = power shot) · Shift+Q = finesse · F = chip · ←/→ = knock-and-go cut ·
//          Z step-over · X ball-roll · C roulette · ↓ drag-back · hold Shift = strafe dribble.
// DEFEND:  Space = switch (nearest ball) · ←/→ = switch toward that side · hold Shift = jockey ·
//          R = standing tackle · F = slide tackle · hold Q = second-man press.
// KEEPER:  Space = throw out · Q = punt.
export const KEYS = {
  up: ['w'],
  down: ['s'],
  left: ['a'],
  right: ['d'],
  sprint: ['arrowup'],
  switchLeft: ['arrowleft'],
  switchRight: ['arrowright'],
  dragback: ['arrowdown'],
  pass: [' ', 'space', 'spacebar'],
  shoot: ['q'], // shoot (attack) / second-man press (defend) / punt (keeper)
  skill: ['r'], // standing tackle (defend)
  jockey: ['shift'], // L2/LT modifier: jockey (defend) / strafe (carry) / finesse (shoot)
  through: ['e'], // through ball
  fAction: ['f'], // chip shot (carry) / slide tackle (defend)
  stepover: ['z'],
  ballRoll: ['x'],
  roulette: ['c'],
}

export const STAMINA = {
  DRAIN: 0.1, // base /s while sprinting (empties in ~10s of constant sprint)
  REGEN: 0.22, // base /s while not sprinting (refills in ~4.5s)
  MIN_SPEED_MULT: 0.72, // top-speed multiplier at empty stamina
  SPRINT_FLOOR: 0.05, // can't sprint below this
  // The STAMINA game-skill scales these base rates. A low-stamina player (attr→0)
  // drains DRAIN_MAX_MULT× faster and regens REGEN_MIN_MULT× as fast; a maxed
  // stamina player (attr→99) drains DRAIN_MIN_MULT× and regens REGEN_MAX_MULT×.
  DRAIN_MAX_MULT: 1.55, // drain multiplier at stamina attr 0
  DRAIN_MIN_MULT: 0.6, // drain multiplier at stamina attr 99
  REGEN_MIN_MULT: 0.65, // regen multiplier at stamina attr 0
  REGEN_MAX_MULT: 1.6, // regen multiplier at stamina attr 99
}

// Tackle archetypes. `reach` adds to BALL.CONTROL_R.
// STEAL = standing tackle (R). SLIDE = committed slide (F): long reach, big reward, brutal
// recover if you miss. CLEAR = win-and-hoof.
export const TACKLE = {
  STEAL: { reach: 0.95, lunge: 0.7, bonus: 0.16, recover: 0.35, nudge: 0.65 },
  CLEAR: { reach: 0.95, lunge: 0.6, bonus: 0.1, recover: 0.42, nudge: 0.5 },
  SLIDE: { reach: 1.55, lunge: 1.0, bonus: 0.2, recover: 0.9, nudge: 0.0 },
}

// Slide tackle motion: a scripted, committed slide along the defender's facing.
export const SLIDE = {
  DURATION: 0.55, // s of the slide itself
  SPEED: 11, // m/s launch along facing
  FRICTION: 9, // m/s^2 decel during the slide
  GOALSIDE_BONUS: 0.12, // easier when sliding across the carrier's path (good timing)
}

// Jockey (hold Shift on defence): a controlled containing shuffle, face the ball.
export const JOCKEY = {
  SPEED_MULT: 0.72, // top-speed multiplier while jockeying (a shuffle, not a sprint)
  STRAFE_MULT: 0.86, // carry strafe (face goal, move laterally with close control)
}

// Shielding: carrier turns his back to the nearest defender; geometry puts the ball on the
// far side of his body. A stronger carrier resists the contest while shielding.
export const SHIELD = {
  RANGE: 2.2, // a defender within this triggers a shield when you push away from him
  CONTEST_RESIST: 0.5, // multiplies the defender's contact-steal chance vs a shielding carrier
}

// Second-man press (hold Q on defence): conduct the nearest AI team-mate into an aggressive
// press of the carrier while you keep your covering defender.
export const SECOND_MAN = { DURATION: 1.8, CLOSE_PACE: 1.0 }

// Through ball (E): seek a runner in behind and lead him generously.
export const THROUGH = {
  LEAD: 0.7, // seconds of the receiver's velocity to lead him by
  PUSH: 4.5, // extra metres pushed into the channel ahead of the run
  SPEED_MIN: 12,
  SPEED_MAX: 19,
}

// Physical duels / shoulder barge. When two players collide at speed the higher-momentum
// (mass × speed) one barely slows; the loser gets a brief stagger.
export const BARGE = {
  REL_SPEED: 2.6, // min closing speed along the contact normal to trigger a duel
  MARGIN: 1.15, // winner needs this momentum ratio to clearly shrug the loser off
  STAGGER: 0.4, // s of stagger slowdown on the loser
  STAGGER_MULT: 0.55, // loser's top-speed multiplier while staggered
}

// Volleys / half-volleys: striking a ball arriving at shin/knee height out of the air.
export const VOLLEY = {
  MIN_H: 0.5, // height band for a foot volley (above this is fine; header band starts at 1.4)
  MAX_H: 1.4,
  MIN_SPEED: 7, // only a ball arriving with pace is volleyed (else it's trapped/chested)
  SHOT_SPRAY: 0.16, // volleys are harder to keep down (extra accuracy spray)
}

// Skill moves (right-stick flicks on a pad → letter keys here). Each routes through the
// existing protect/burst system: a good move buys a beat and steal-immunity.
export const SKILL = {
  COOLDOWN: 0.45, // s between skill moves
  STEPOVER_PROTECT: 0.32, // feint: shifts the defender read, small immunity
  BALLROLL_PROTECT: 0.3,
  BALLROLL_SHIFT: 0.9, // m lateral ball/-body shift on a ball roll
  DRAGBACK_PROTECT: 0.45, // escape move: reverse out of pressure
  DRAGBACK_BACK: 1.2, // m the ball is dragged back
  ROULETTE_PROTECT: 0.65, // strongest escape, but slower (you spin on the spot)
  ROULETTE_SLOW: 0.35, // s of reduced speed after a roulette
}

// Plain-contact possession contest: standing/running into an opponent risks the ball
// unless the carrier is protected by an active dribble move. Symmetric for both teams.
// A clean steal is GATED on positioning (goal-side or in the carrier's travel lane) so possession
// is won by being in the right place, not by a lucky contact roll — keeping it from feeling pinbally.
export const CONTEST = {
  range: 0.45, // added to CONTROL_R for the contact zone (~1.85 m)
  interval: 0.34, // s between contest rolls per defender
  base: 0.34, // base steal chance per roll at equal ratings (when well-positioned)
  ratingSwing: 0.42, // how much (defending - dribbling) shifts it
  sprintInto: 0.12, // extra steal chance when the carrier sprints straight into a defender
  // ---- positioning gate ----
  GOAL_SIDE_EPS: 0.4, // a defender is "goal-side" if he's level-or-ahead of the carrier toward goal
  LANE_DOT: 0.35, // ...or planted in the carrier's path (cosine of carrier-velocity → defender)
  POOR_POS_MULT: 0.18, // a poke from behind / a bad angle (out of position) rarely wins it cleanly
}

// Dribble move (←/→ on attack = cut left / right): a skill move to beat the nearest defender.
// The DIRECTION you pick matters: cut into the space away from the defender and you beat him;
// dribble straight into him and you'll likely lose it. Reading the defender is the skill.
export const DRIBBLE = {
  base: 0.4, // success at equal ratings, neutral angle
  ratingSwing: 0.5, // (dribbling - defending) influence
  AWAY_BONUS: 0.32, // cutting to the open side, away from the defender (the right read)
  INTO_PENALTY: 0.42, // cutting straight into the side the defender is on (the wrong read)
  JAMMED: 0.12, // extra penalty when a defender is right on top of you
  protect: 0.6, // s of steal-immunity after a successful move
  boost: 0.3, // speed boost while protected (explosive past the defender)
  beatRecover: 0.85, // s the beaten defender is slowed (you get a clear yard)
  cooldown: 0.4, // s between dribble moves
}

// Defensive shape / jockeying. AI defenders contain rather than constantly dive in
// (mirrors EA FC: jockey to stay goal-side, fewer reckless lunges and easy catches).
export const DEFEND = {
  JOCKEY_STANDOFF: 1.95, // hold just outside the contact-contest zone (contest only when driven into)
  COVER_GOALSIDE: 2.4, // how far goal-side a covering defender sits off his man
  CHASE_PACE: 0.94, // recovering defenders run a touch slower than flat-out (can't always catch pace)
  RUSH_DIST: 16, // GK rushes out to contain a clear runner within this of goal
}

// Team tactics — how far each player-set slider moves the underlying shape/press/run numbers.
// Applied to YOUR team so it plays with an identity (the opponent stays balanced).
export const TACTICS = {
  LINE_RANGE: 14, // m the whole block's Z shifts from full-deep (0) to high line (1)
  MENTALITY_PUSH: 7, // m extra the block pushes forward at full-attacking (and drops at defensive)
  MENTALITY_WIDTH: 0.16, // ± width (fraction of half-width) added to mids/wingers by mentality
  PRESS_STANDOFF: 1.0, // m the presser tightens his containing standoff at full press
  PRESS_GAP_HI: 4.0, // sprint-to-close gap threshold at zero press (contain / hold shape)
  PRESS_GAP_LO: 1.6, // ...and at full press (jump out and hunt the ball sooner)
  RUN_CHANCE: 0.22, // ± added to the off-ball in-behind run-trigger chance by mentality
}

// Off-ball attacking runs — keeps the attack alive with real options.
export const RUN = {
  TRIGGER_MIN: 1.4, // s minimum between a forward run decision
  TRIGGER_MAX: 3.2,
  DURATION: 2.1, // s a triggered in-behind run lasts before checking back
  BEHIND: 9, // how far beyond the carrier a striker tries to get in behind
  WIDTH: 0.7, // how wide wingers hold (fraction of half-width)
}

// First touch + possession settle. On gaining the ball a player gets a brief settle where
// he can't be dispossessed (kills the ball pinging straight back). A poor first touch under
// pressure can still squirt loose, but it's rarer now so play flows.
export const TOUCH = {
  SETTLE: 0.4, // s of dispossession-immunity right after gaining the ball
  HEAVY_BASE: 0.14, // base chance of a heavy first touch when receiving under pressure
  HEAVY_SWING: 0.22, // reduced by dribbling/control rating
  HEAVY_PUSH: 1.9, // how far a heavy touch squirts the ball (m/s)
  PRESSURE_R: 2.2, // a defender within this counts as pressure
  CHEST_MIN: 0.95, // ball heights in [CHEST_MIN, CHEST_MAX] are brought down with a chest trap
  CHEST_MAX: 1.7,
}

// Goalkeeping.
export const GK = {
  baseReach: 1.35, // metres of dive reach at gk=0
  reachGain: 1.3, // extra reach at gk=99 (top keepers reach ~2.65m — still can't fully cover the mouth)
  reactDist: 22, // starts reacting to shots within this distance
  catchSpeed: 18, // below this a clean catch; above → parry
  parrySpeed: 10, // parried balls fly out around this speed
  HOLD_TIME: 0.65, // s the keeper holds the ball before distributing
  SCOOP_TIME: 0.4, // s of the keeper scooping a gathered ball up off the turf into his hands
  THROW_MIN: 10, // throw speed to a near team-mate
  THROW_MAX: 19, // throw speed to a far team-mate
  THROW_RANGE: 30, // furthest a throw is attempted (else punt)
  CLAIM_R: 2.6, // a loose ball within this of the keeper is gathered with the hands
  CLAIM_SPEED: 17, // only claim balls slower than this (faster = needs a dive)
  COME_FOR_IT: 9, // keeper rushes out to a loose ball this far into his box
  // ---- save variety ----
  FEET_H: 0.9, // a save at/below this height is a save-with-the-feet (low/near)
  TIP_H: 1.7, // a save at/above this height is tipped over the bar (out for a corner)
  SMOTHER_R: 2.4, // smother a 1v1 ball at the striker's feet within this of the keeper
  ERROR_CHANCE: 0.07, // chance a catchable save is spilled into danger instead (drama)
  // ---- pre-shift (high-gk keepers read the shooter's body/aim slightly) ----
  PRESHIFT_GAIN: 1.0, // metres a gk=99 keeper pre-leans toward the likely placement side
  PRESHIFT_RANGE: 12, // only pre-reads a shooter winding up within this distance
}

export const SHOT = {
  // Ball speed is rating-driven: a great shooter strikes it noticeably harder than a poor one.
  MIN_POWER: 15, // base ball speed at shooting = 0
  MAX_POWER: 29, // base ball speed at shooting = 99 (power-bar still scales on top of this)
  CHARGE_TIME: 0.85, // s to fully charge the power bar (hold Q)
  // Height model — the heart of the EA-FC power feel. A shot's launch angle grows with how
  // hard you hit it; but every distance has an IDEAL power, and over-hitting for the distance
  // balloons the ball OVER THE BAR (worst when you blast it from close range). Under-hitting
  // from range leaves it weak and dropping short. Better shooters control the power better.
  LIFT_BASE: 0.12, // launch angle (as a fraction of pace) for a well-weighted strike
  LIFT_GAIN: 0.1, // extra launch per unit of power (hold longer → higher)
  OVERHIT: 0.6, // how violently over-hitting for the distance skies it over the bar
  IDEAL_NEAR: 0.22, // ideal charge right on top of goal…
  IDEAL_PER_M: 0.025, // …rising this much per metre of distance (far shots need full power)
  // Finesse: a short tap is a placed/curled side-foot finish — tidy and low, lethal up close.
  FINESSE_CHARGE: 0.5, // charge at/below this reads as a finesse shot (no modifier)
  FINESSE_SPEED: 0.82, // finesse shots are struck softer than a driven shot
  CURL: 2.4, // finesse shots aim this far toward the far post (m)
  BOX_ACC: 0.13, // accuracy bonus when shooting from inside the box (EA TU8 vibe)
  PRESSURE_SPRAY: 0.2, // extra placement spray when closely pressured
  MOVING_SPRAY: 0.12, // extra spray when shooting at a full sprint (off balance)
  // ---- shot types & spin (real Magnus, see BALL) ----
  POWER_CHARGE: 0.9, // a full-charge strike becomes a power shot
  POWER_PACE: 1.12, // power-shot ball-speed multiplier
  POWER_SPRAY: 0.06, // power shots are a touch less accurate
  FINESSE_SPIN: 8.5, // side-spin magnitude for a finesse curl
  CROSS_SPIN: 5.0, // side-spin on a whipped cross
  DRIVEN_SPIN: 6.0, // top-spin on a driven/power shot (it DIPS under the bar)
  CHIP_SPIN: 5.5, // back-spin on a chip/lob (it floats and hangs)
  CHIP_PACE: 0.6, // a chip is struck softly…
  CHIP_LIFT: 0.5, // …and high, to clip it over a rushing keeper
  // ---- wind-up & timed finishing ----
  WINDUP: 0.13, // s of wind-up before contact on a normal shot
  WINDUP_POWER: 0.26, // power shots wind up longer (and punch the camera)
  TIMED_WINDOW: 0.12, // s before contact in which a second tap counts as "timed"
  TIMED_ACC: 0.55, // accuracy-spray multiplier on a perfectly timed finish
  TIMED_PACE: 1.06, // a timed finish is struck a touch cleaner/harder
}

export const PASS = {
  SPEED_NEAR: 9,
  SPEED_FAR: 17,
  THROUGH_SPEED: 13,
  CROSS_SPEED: 14,
  CROSS_LOFT: 0.5,
  CHARGE_TIME: 0.6, // s of holding Space to reach a full lofted cross
  LEAD: 0.45, // how much to lead a moving receiver / run
  LANE_R: 1.7, // an opponent within this of the pass line is "in the lane" (would cut it out)
}

// Crossing (F). EA-FC-style: the ball is flighted to LAND on a runner who is led by the cross's
// flight time, and both the weight and the accuracy scale with the crosser's passing — a poor
// crosser under/over-hits and sprays it, a great one whips it pinpoint onto the runner's head.
export const CROSS = {
  LOFT: 0.5, // vy/vh arc ratio — whipped, arrives around head height on the drop
  LEAD: 0.9, // fraction of the ball's flight time to lead the runner's movement by
  SPRAY_MAX: 0.14, // direction spray (rad) at passing = 0 → ~0 at 99
  WEIGHT_ERR: 0.22, // ± range error (drops short / overhits) at passing = 0 → ~0 at 99
  SPEED_MIN: 9, // clamp on the solved horizontal pace
  SPEED_MAX: 22,
}
