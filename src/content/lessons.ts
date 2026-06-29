import type { Lesson, Unit, SimState } from '../types'

export const UNITS: Unit[] = [
  {
    id: 'kinematics',
    index: 0,
    name: 'Kinematics',
    blurb: 'Free-Kick Physics: Score the Goal',
    lessonId: 'lesson-projectile',
  },
  {
    id: 'motion-graphs',
    index: 1,
    name: 'Motion Graphs',
    blurb: 'Through-Ball: Lead the Runner',
    lessonId: 'lesson-motion-graphs',
  },
  {
    id: 'forces',
    index: 2,
    name: 'Forces',
    blurb: 'Dribbling Practice: F = m·a',
    lessonId: 'lesson-forces',
  },
  {
    id: 'energy',
    index: 3,
    name: 'Energy',
    blurb: 'Headers: Win the Cross',
    lessonId: 'lesson-energy',
  },
  {
    id: 'momentum',
    index: 4,
    name: 'Momentum',
    blurb: 'Defending: Win the Ball',
    lessonId: 'lesson-defense',
  },
  // NOTE: the impulse / Goalkeeping unit is intentionally NOT offered. Its lesson
  // (`lesson-goalie`), the GoalieSim, GoalieQuiz, and bank are all kept in the
  // codebase, just not surfaced as a unit. To re-enable it, add it back here.
]

export const UNIT_THEME: Record<string, { icon: string; accent: string; tagline: string }> = {
  kinematics: { icon: '⚽', accent: '#22c55e', tagline: 'Score the goal' },
  'motion-graphs': { icon: '📈', accent: '#06b6d4', tagline: 'Lead the runner' },
  forces: { icon: '🏃', accent: '#ef4444', tagline: 'Beat your man' },
  energy: { icon: '🤾', accent: '#10b981', tagline: 'Win the header' },
  momentum: { icon: '🛡️', accent: '#a855f7', tagline: 'Win the ball back' },
  impulse: { icon: '🧤', accent: '#f59e0b', tagline: 'Make the save' },
}

const num = (s: SimState, k: string): number => Number(s[k] ?? 0)

export const LESSONS: Record<string, Lesson> = {
  'lesson-projectile': {
    id: 'lesson-projectile',
    unitId: 'kinematics',
    title: 'Free-Kick Physics: Score the Goal',
    estimatedMinutes: 7,
    sim: 'freekick',
    defaultSimState: { speed: 18, angle: 20, scored: 0 },
    challengeGoal: (s) => num(s, 'scored') >= 1,
    steps: [
      {
        id: 'proj-concept',
        kind: 'concept',
        prompt: 'A struck ball is projectile motion',
        body: 'The instant your boot leaves the ball, the only force on it is gravity, so it is in free fall — a projectile. The big idea in AP Physics is that the horizontal and vertical motions are completely independent. Horizontally there is no force, so the horizontal velocity vₓ = v·cosθ never changes for the whole flight. Vertically, gravity supplies a constant downward acceleration g ≈ 10 m/s², so the vertical velocity v_y = v·sinθ shrinks on the way up, hits zero at the peak, then grows on the way down. The two motions share one clock: the time in the air is decided entirely by the vertical motion, and during that same time the steady vₓ carries the ball toward goal. Score by tuning the launch speed and angle so the ball is right under the crossbar exactly when it arrives.',
      },
      {
        id: 'proj-sandbox',
        kind: 'sandbox',
        prompt: 'Explore the strike: drag the launch speed and angle, watch the arc bend toward the goal, then take the shot. Get a feel for how speed trades off against angle, and bury one in the top corner to move on.',
        body: '',
      },
      {
        id: 'proj-prediction',
        kind: 'prediction',
        prompt: 'A keeper, standing tall, lets one ball drop straight down from his hands and at the very same instant punts an identical ball horizontally off at high speed — both leaving from the same height. Ignoring air resistance, which ball hits the ground first?',
        options: [
          { id: 'same', label: 'Both at the same time — vertical motion is independent of horizontal motion' },
          { id: 'punt', label: 'The punted ball, because it is moving faster' },
          { id: 'drop', label: 'The dropped ball, because it goes straight down' },
          { id: 'longer', label: 'The punted ball, because its horizontal speed keeps it up longer' },
        ],
        correctOptionId: 'same',
        conceptTags: ['projectile-horizontal-vertical-independence', 'projectile-time-of-flight'],
        feedbackCorrect:
          'Right. Both balls start with zero vertical velocity and fall under the same g, so their vertical motions are identical: they land together. The punt’s horizontal velocity carries it sideways but adds nothing to the vertical fall — horizontal and vertical motion are independent.',
        feedbackByOption: {
          punt: 'Speed sideways does not change how fast something falls. Horizontally there is no force, so vₓ never affects the vertical drop.',
          drop: 'It does go straight down, but the punted ball is ALSO falling straight down at the same rate — its sideways motion is separate. They land together.',
          longer: 'Horizontal speed cannot hold a ball up; only the vertical motion sets the time in the air, and that is identical for both.',
        },
        hint: 'The time to fall depends only on the vertical motion. Do the two balls start with the same vertical velocity and the same g?',
      },
      {
        id: 'proj-numeric',
        kind: 'numeric',
        prompt: 'You strike the ball at 24 m/s, 30° above the ground. What is the upward part of the velocity, vy = v·sinθ? (sin 30° = 0.5)',
        unitLabel: 'm/s',
        correctAnswer: 12,
        tolerance: 1,
        nearMissTolerance: 3,
        conceptTags: ['projectile-horizontal-vertical-independence'],
        feedbackCorrect:
          'Correct. vy = v·sinθ = 24 × 0.5 = 12 m/s lifts the ball, while vx = v·cosθ = 24 × cos30° ≈ 20.8 m/s drives it at goal.',
        feedbackIncorrect:
          'Not yet. The upward part uses sine: vy = v·sinθ = 24 × sin30° = 24 × 0.5.',
        feedbackNearMiss:
          'Close. Use sinθ for the vertical part (not cosθ): 24 × 0.5.',
        hint: 'Vertical velocity uses sine: vy = v·sinθ = 24 × 0.5.',
      },
      {
        id: 'proj-challenge',
        kind: 'challenge',
        prompt: 'Now apply it on purpose: set the speed and angle so the ball passes through the target ring up in the corner, and take the shot.',
        goalDescription: 'Score 1 goal: pass the ball through the glowing target ring.',
        conceptTags: ['projectile-range', 'projectile-time-of-flight'],
        feedbackCorrect:
          'Top corner! You found a speed and angle that put the ball at the right height exactly when it reached the goal, distance d away. Projectile motion, applied.',
        feedbackIncorrect:
          'Keep going. The ball needs the right height at the goal line: vx = v·cosθ sets the time to arrive, t = d/vx, and y = vy·t − ½g·t² is the height when it gets there. Overshoot sails over, undershoot drops short.',
        hint: 'Read the live values: vx = v·cosθ drives it forward, vy = v·sinθ lifts it. Raise the angle for more height, add speed for more reach. Watch the "height at goal" readout move toward the ring.',
      },
      {
        id: 'proj-quiz',
        kind: 'quiz',
        prompt: 'Final Quiz: Penalty Physics',
      },
      {
        id: 'proj-summary',
        kind: 'summary',
        prompt: 'Projectile motion mastered',
        body: 'You split a real strike into independent horizontal and vertical motion, reasoned about how angle trades pace for height, computed a velocity component, and landed the ball in a ring you chose. Next up: Motion Graphs.',
      },
    ],
  },

  'lesson-motion-graphs': {
    id: 'lesson-motion-graphs',
    unitId: 'motion-graphs',
    title: 'Through-Ball: Lead the Runner',
    estimatedMinutes: 7,
    sim: 'passing',
    defaultSimState: { connections: 0 },
    challengeGoal: (s) => num(s, 'connections') >= 1,
    steps: [
      {
        id: 'mg-concept',
        kind: 'concept',
        prompt: 'A pass is a graph problem',
        body: 'Plot a player’s position against time and the picture tells you everything. On a position–time (x–t) graph the SLOPE is the velocity: a steeper line means a faster player, a flat line means standing still, and a downward line means moving backward. Where the line starts on the axis is the head start x₀, and at steady speed x = x₀ + v·t. (On a velocity–time graph it flips: the slope is acceleration and the area underneath is the distance covered.) A through-ball is just two x–t lines on the same axes — the runner’s and your pass’s — and the ball connects exactly where the two lines cross. Weight the pass so that crossing point lands in the space ahead of the run.',
      },
      {
        id: 'mg-sandbox',
        kind: 'sandbox',
        prompt: 'Thread one through: read the runner’s line, set your pass speed, and connect inside the space.',
        body: '',
      },
      {
        id: 'mg-prediction',
        kind: 'prediction',
        prompt: 'A teammate’s run is drawn on a position–time graph: a gentle upward slope for the first 3 seconds, then the line suddenly becomes much steeper. What did the player do?',
        options: [
          { id: 'faster', label: 'Sped up — a steeper x–t slope means a greater velocity' },
          { id: 'slower', label: 'Slowed down — a steeper line means less speed' },
          { id: 'stopped', label: 'Stopped and then reversed direction' },
          { id: 'same', label: 'Kept exactly the same speed the whole time' },
        ],
        correctOptionId: 'faster',
        conceptTags: ['graph-slope-as-velocity', 'graph-velocity-direction'],
        feedbackCorrect:
          'Right. On a position–time graph the slope IS the velocity, so a steeper line means the player covered more ground each second — they accelerated into the run.',
        feedbackByOption: {
          slower: 'Backwards: a steeper x–t slope is MORE speed, not less. A gentler slope would mean slowing down.',
          stopped: 'Reversing would bend the line back downward. Here it stays upward and just gets steeper — that is speeding up.',
          same: 'Same speed would keep the same slope (one straight line). The slope changed, so the velocity changed.',
        },
        hint: 'On an x–t graph, slope = velocity. Does a steeper line mean faster or slower?',
      },
      {
        id: 'mg-numeric',
        kind: 'numeric',
        prompt: 'A teammate starts 8 m ahead of you and runs at a steady 4 m/s. Using x = x₀ + v·t, what is his position after 4 s?',
        unitLabel: 'm',
        correctAnswer: 24,
        tolerance: 1,
        nearMissTolerance: 3,
        conceptTags: ['graph-slope-as-velocity'],
        feedbackCorrect: 'Correct. x = x₀ + v·t = 8 + 4×4 = 8 + 16 = 24 m. That 24 m point is where you’d aim the pass to meet him.',
        feedbackIncorrect: 'Use x = x₀ + v·t = 8 + 4×4. Add the head start to the distance run.',
        feedbackNearMiss: 'Close. Don’t forget to add the 8 m head start to the 16 m he runs.',
        hint: 'Distance run is v·t = 4×4 = 16 m, then add the head start x₀ = 8 m.',
      },
      {
        id: 'mg-challenge',
        kind: 'challenge',
        prompt: 'Slot a through-ball into the space: set the pass speed so your line crosses the runner’s inside the green zone.',
        goalDescription: 'Connect one through-ball in the target space.',
        conceptTags: ['graph-slope-as-velocity', 'graph-velocity-direction'],
        feedbackCorrect:
          'Threaded it. You read the runner’s slope and head start, picked a pass speed whose line crossed his right in the space, and the ball met the run perfectly.',
        feedbackIncorrect:
          'Not connected. If the ball arrives behind the run, add pace; if it meets him before the space, take pace off. Aim for the crossing point to land in the green band.',
        hint: 'Required pass speed ≈ target ÷ (time to reach it). Read the runner’s line, then match your slope so the lines cross in the zone.',
      },
      {
        id: 'mg-quiz',
        kind: 'quiz',
        prompt: 'Final Quiz: Motion Graphs',
      },
      {
        id: 'mg-summary',
        kind: 'summary',
        prompt: 'Motion graphs mastered',
        body: 'You read slope as velocity, used x = x₀ + v·t to place a runner, and threaded a through-ball by crossing two lines in the right spot. Next up: Forces.',
      },
    ],
  },

  'lesson-forces': {
    id: 'lesson-forces',
    unitId: 'forces',
    title: 'Dribbling Practice',
    estimatedMinutes: 6,
    sim: 'forces',
    defaultSimState: { connections: 0 },
    challengeGoal: (s) => num(s, 'connections') >= 1,
    steps: [
      {
        id: 'force-concept',
        kind: 'concept',
        prompt: 'Every dribble move is F = m·a',
        body: 'Newton’s first law says the ball keeps doing whatever it is doing — sitting still or rolling straight — until a NET force acts on it. That force is your boot. Newton’s second law then sets exactly what happens: F = m·a, the net force equals mass times acceleration. Every dribble move pushes the SAME ball, so the mass is a constant m = 0.43 kg; only the force and the resulting acceleration change. Push twice as hard and you get twice the acceleration. And by Newton’s third law, when your boot pushes the ball the ball pushes back on your boot just as hard — equal and opposite. Whether you cut it sideways, scoop it up, or spin out into space, that one rule sets the force behind the touch.',
      },
      {
        id: 'force-sandbox',
        kind: 'sandbox',
        prompt: 'Dribbling practice: a defender is closing. Press 1-3 to pick a move, then solve its force (F = m·a) or acceleration (a = F/m) to beat your man.',
        body: '',
      },
      {
        id: 'force-prediction',
        kind: 'prediction',
        prompt: 'As you strike the ball, your boot pushes forward on it. According to Newton’s third law, what does the ball do to your boot?',
        options: [
          { id: 'equal', label: 'Pushes back on your boot with an equal and opposite force' },
          { id: 'smaller', label: 'Pushes back, but with a smaller force because the ball is lighter' },
          { id: 'none', label: 'Does not push back at all — your boot just moves it' },
          { id: 'bigger', label: 'Pushes back harder than your boot pushes it' },
        ],
        correctOptionId: 'equal',
        conceptTags: ['force-net-force'],
        feedbackCorrect:
          'Right. Newton’s third law: the two forces are equal in size and opposite in direction, and they act on different objects (boot vs ball). The ball flies off and your boot barely moves only because the ball has far less mass — same force, F = m·a gives it a much bigger acceleration.',
        feedbackByOption: {
          smaller: 'The forces in a Newton’s-third-law pair are always equal in size. The lighter ball gets a bigger ACCELERATION from that equal force, but the force on your boot is just as big.',
          none: 'It must push back — third-law force pairs always come together. You feel it as the thud on your boot.',
          bigger: 'Neither force is bigger; they are exactly equal and opposite. Only the accelerations differ, because the masses differ.',
        },
        hint: 'Third-law pairs are equal in size, opposite in direction, and act on two different objects.',
      },
      {
        id: 'force-numeric',
        kind: 'numeric',
        prompt: 'Coming out of a spin move, you drive the 0.43 kg ball into space at a = 100 m/s². What force does your foot put through it? (F = m·a)',
        unitLabel: 'N',
        correctAnswer: 43,
        tolerance: 1,
        nearMissTolerance: 5,
        conceptTags: ['force-net-force'],
        feedbackCorrect: 'Correct. F = m·a = 0.43 × 100 = 43 N. That is the push behind the spin.',
        feedbackIncorrect: 'Use F = m·a. Multiply the fixed mass 0.43 kg by the acceleration 100 m/s².',
        feedbackNearMiss: 'Close. F = m·a = 0.43 × 100 = 43 N.',
        hint: 'F = m·a = 0.43 × 100.',
      },
      {
        id: 'force-challenge',
        kind: 'challenge',
        prompt: 'Dribbling practice: pick a move with 1-3, then solve its F = m·a (or a = F/m) to beat the defender.',
        goalDescription: 'Beat the defender by pulling off one dribbling move.',
        conceptTags: ['force-net-force'],
        feedbackCorrect:
          'Beat him. You held the ball mass at 0.43 kg and used F = m·a (or a = F/m) to put the exact force behind your move.',
        feedbackIncorrect:
          'Lost it. Too much force flings the ball away, too little and it never gets there. Solve F = m·a (or a = F/m) for the move you picked.',
        hint: 'Mass is always 0.43 kg. Find the force with F = m·a, or the acceleration with a = F/m.',
      },
      {
        id: 'force-quiz',
        kind: 'quiz',
        prompt: 'Final Quiz: Dribbling Forces',
      },
      {
        id: 'force-summary',
        kind: 'summary',
        prompt: 'Dribbling mastered',
        body: 'You used Newton\u2019s 2nd law both ways on a constant 0.43 kg ball: F = m·a to find the force behind a move, and a = F/m to find the acceleration it produces. Next up: Energy.',
      },
    ],
  },

  'lesson-energy': {
    id: 'lesson-energy',
    unitId: 'energy',
    title: 'Headers: Win the Cross',
    estimatedMinutes: 6,
    sim: 'energy',
    defaultSimState: { connections: 0 },
    challengeGoal: (s) => num(s, 'connections') >= 1,
    steps: [
      {
        id: 'energy-concept',
        kind: 'concept',
        prompt: 'A header is an energy problem',
        body: 'To win a header you have to climb to the ball, and energy bookkeeping tells you how. At take-off your legs give you kinetic energy KE = ½mv². As you rise, gravity does negative work and that kinetic energy is converted into gravitational potential energy PE = mgh. If we ignore air resistance, mechanical energy is conserved, so at the very top of your leap (where your speed is zero) all of the KE has become PE: ½mv² = mgh. The mass appears on both sides and cancels, leaving v = √(2gh) — the take-off speed needed to reach height h, using g = 10 m/s². Two lessons fall out: a higher ball needs more take-off speed, and your body mass does not matter for how high you get. (Notice KE depends on v², so a little extra speed buys a lot more height.)',
      },
      {
        id: 'energy-sandbox',
        kind: 'sandbox',
        prompt: 'A corner is swinging in. Press 1-3 to pick a header (near post, back post, towering), then solve the take-off speed v = √(2gh) (or the height h = v²/2g) to climb highest and bury it. Score all three to move on.',
        body: '',
      },
      {
        id: 'energy-prediction',
        kind: 'prediction',
        prompt: 'On your second header you leave the turf at TWICE the take-off speed of your first. Compared with the first jump, the kinetic energy you launch with is…',
        options: [
          { id: 'quad', label: 'Four times as much — KE = ½mv², so doubling v quadruples KE' },
          { id: 'double', label: 'Twice as much' },
          { id: 'same', label: 'The same — it is the same body' },
          { id: 'half', label: 'Half as much' },
        ],
        correctOptionId: 'quad',
        conceptTags: ['energy-conservation'],
        feedbackCorrect:
          'Right. Kinetic energy depends on the SQUARE of the speed: KE = ½mv². Double v and v² goes up by 4, so the KE (and the height you can reach) quadruples. That is why a little extra spring pays off so much.',
        feedbackByOption: {
          double: 'KE is not proportional to v, it is proportional to v². Doubling v multiplies KE by 2² = 4, not 2.',
          same: 'Same body (same m), but you changed v. Since KE = ½mv², more speed means more energy.',
          half: 'More speed means more energy, not less — and it grows as v², so it is 4× here.',
        },
        hint: 'KE = ½mv². How does squaring a doubled speed change the result?',
      },
      {
        id: 'energy-numeric',
        kind: 'numeric',
        prompt: 'A towering header needs you to rise to h = 1.8 m at the top of your jump. What take-off speed gets you there? (v = √(2gh), g = 10)',
        unitLabel: 'm/s',
        correctAnswer: 6,
        tolerance: 1,
        nearMissTolerance: 2,
        conceptTags: ['energy-conservation'],
        feedbackCorrect: 'Correct. v = √(2·10·1.8) = √36 = 6 m/s. That is the spring you need off the turf.',
        feedbackIncorrect: 'Use v = √(2gh) = √(2 · 10 · 1.8).',
        feedbackNearMiss: 'Close. Take the square root: v = √(2gh), not 2gh.',
        hint: 'Compute 2·10·1.8 = 36, then take the square root.',
      },
      {
        id: 'energy-challenge',
        kind: 'challenge',
        prompt: 'Score all three headers from corners: near post, back post, and towering. Pick with 1-3, then solve v = √(2gh) (or h = v²/2g) to climb highest and beat the keeper. The drill is done when all three are buried.',
        goalDescription: 'Score all 3 header types (near post, back post, towering).',
        conceptTags: ['energy-conservation'],
        feedbackCorrect:
          'Hat-trick of headers! You converted take-off energy into height with v = √(2gh) on all three, getting up above the defenders to bury near post, back post and the towering header.',
        feedbackIncorrect:
          'Beaten in the air. Too little take-off speed and you stay low; too much and you mistime it. Solve v = √(2gh) (or h = v²/2g) for the header you picked.',
        hint: 'Gravity is g = 10. Find the take-off speed with v = √(2gh), or the height reached with h = v²/(2g). You need all three header types.',
      },
      {
        id: 'energy-quiz',
        kind: 'quiz',
        prompt: 'Final Quiz: Header Energy',
      },
      {
        id: 'energy-summary',
        kind: 'summary',
        prompt: 'Headers mastered',
        body: 'You turned a header into energy conservation: mgh = ½mv² gives v = √(2gh), with the mass cancelling out. You found the take-off speed to reach a ball, and the height a given spring earns. More skills are on the way.',
      },
    ],
  },

  'lesson-defense': {
    id: 'lesson-defense',
    unitId: 'momentum',
    title: 'Defending: Win the Ball',
    estimatedMinutes: 6,
    sim: 'defense',
    defaultSimState: { connections: 0 },
    challengeGoal: (s) => num(s, 'connections') >= 1,
    steps: [
      {
        id: 'def-concept',
        kind: 'concept',
        prompt: 'A tackle is a momentum problem',
        body: 'Momentum is mass in motion: p = m·v, an attacker’s mass times his velocity, pointing the way he runs. It is a vector, and it depends on BOTH factors together — a heavy striker jogging in and a light winger sprinting in can carry exactly the same p, so you can’t judge a threat by size or speed alone, only by the product. The deeper AP idea is conservation: in any collision (or tackle) the total momentum of the system is unchanged unless an outside force acts, and the momentum one body loses the other gains. To win the ball cleanly you have to absorb the attacker’s momentum — read how much is coming, time your challenge, and take it.',
      },
      {
        id: 'def-sandbox',
        kind: 'sandbox',
        prompt: 'An attacker is driving at you. Press 1-3 to pick a defensive challenge, then solve its momentum p = m·v (or the speed v = p/m) to win the ball.',
        body: '',
      },
      {
        id: 'def-prediction',
        kind: 'prediction',
        prompt: 'Two attackers come at you. One is 90 kg moving at 4 m/s; the other is 60 kg moving at 6 m/s. Which carries more momentum to stop?',
        options: [
          { id: 'heavy', label: 'The 90 kg at 4 m/s: p = 360 kg·m/s' },
          { id: 'fast', label: 'The 60 kg at 6 m/s: p = 360 kg·m/s — actually equal' },
          { id: 'always-heavy', label: 'The heavier one always, regardless of speed' },
          { id: 'always-fast', label: 'The faster one always, regardless of mass' },
        ],
        correctOptionId: 'fast',
        conceptTags: ['momentum-collisions'],
        feedbackCorrect:
          'Right. p = m·v: 90×4 = 360 and 60×6 = 360. They carry the SAME momentum, so each takes the same effort to stop — momentum depends on mass AND speed together.',
        feedbackByOption: {
          heavy: 'Check the product: 90×4 = 360, but 60×6 = 360 too. They are equal — speed makes up for the lighter mass.',
          'always-heavy': 'Not always. A lighter, faster player can match a heavier one: p = m·v, and here both are 360 kg·m/s.',
          'always-fast': 'Not always. Mass counts too. Here it happens to tie at 360 kg·m/s because m·v is equal.',
        },
        hint: 'Compute m·v for each: 90×4 versus 60×6.',
      },
      {
        id: 'def-numeric',
        kind: 'numeric',
        prompt: 'A striker (m = 80 kg) drives at you at v = 4 m/s. How much momentum must your tackle stop? (p = m·v)',
        unitLabel: 'kg·m/s',
        correctAnswer: 320,
        tolerance: 1,
        nearMissTolerance: 20,
        conceptTags: ['momentum-collisions'],
        feedbackCorrect: 'Correct. p = m·v = 80 × 4 = 320 kg·m/s. That is the momentum your challenge has to absorb.',
        feedbackIncorrect: 'Use p = m·v = 80 × 4. Multiply mass by velocity.',
        feedbackNearMiss: 'Close. p = m·v = 80 × 4 = 320 kg·m/s.',
        hint: 'p = m·v = 80 × 4.',
      },
      {
        id: 'def-challenge',
        kind: 'challenge',
        prompt: 'Win the ball: pick a defensive challenge with 1-3, then solve its p = m·v (or v = p/m) to time the tackle.',
        goalDescription: 'Win the ball back with one clean challenge.',
        conceptTags: ['momentum-collisions'],
        feedbackCorrect:
          'Clean tackle! You read the attacker’s momentum p = m·v (or recovered his speed with v = p/m) and timed the challenge to take the ball.',
        feedbackIncorrect:
          'Beaten. Misjudge his momentum and you arrive wrong — too early or too late. Solve p = m·v (or v = p/m) for the challenge you picked.',
        hint: 'Momentum is p = m·v. Find p from m and v, or recover the speed with v = p/m.',
      },
      {
        id: 'def-quiz',
        kind: 'quiz',
        prompt: 'Final Quiz: Defending & Momentum',
      },
      {
        id: 'def-summary',
        kind: 'summary',
        prompt: 'Defending mastered',
        body: 'You read a tackle as momentum: p = m·v depends on both the attacker’s mass and his speed. You computed the momentum to stop and recovered a speed with v = p/m, then timed clean challenges to win the ball. More skills are on the way.',
      },
    ],
  },

  'lesson-goalie': {
    id: 'lesson-goalie',
    unitId: 'impulse',
    title: 'Goalkeeping: Make the Save',
    estimatedMinutes: 6,
    sim: 'goalie',
    defaultSimState: { connections: 0 },
    challengeGoal: (s) => num(s, 'connections') >= 1,
    steps: [
      {
        id: 'gk-concept',
        kind: 'concept',
        prompt: 'A save is an impulse',
        body: 'A struck ball arrives with momentum p = m·v. To catch it dead your gloves must remove ALL of that momentum, and the change in momentum is called the impulse: J = Δp. The impulse–momentum theorem also writes impulse as force times the contact time, J = F·Δt — which on a force-vs-time graph is just the area under the curve. Rearranged, F = J/Δt: the impulse is fixed by the shot, so the longer you let the contact last, the SMALLER the force on your hands. That is exactly why a keeper "gives" with the ball — soft hands stretch Δt and cut the peak force, while a stiff punch crams the same impulse into an instant and feels far harder. Units tie it together: N·s = kg·m/s. Read the shot, commit a direction, and apply the impulse.',
      },
      {
        id: 'gk-sandbox',
        kind: 'sandbox',
        prompt: 'A striker runs up to shoot. Press 1-3 to commit — dive left, watch the middle, or dive right — then solve the impulse to hold it. Pick the right way once to move on.',
        body: '',
      },
      {
        id: 'gk-prediction',
        kind: 'prediction',
        prompt: 'Two identical shots (same momentum) hit your gloves. On Save A you cushion the ball over a long contact time; on Save B you punch it away almost instantly. Compare the impulse and the force.',
        options: [
          { id: 'same-j-less-f', label: 'Same impulse both times; the slow cushion needs LESS force' },
          { id: 'more-j-cushion', label: 'The slow cushion needs more impulse' },
          { id: 'same-f', label: 'The force is the same either way' },
          { id: 'less-j-cushion', label: 'The slow cushion needs less impulse' },
        ],
        correctOptionId: 'same-j-less-f',
        conceptTags: ['impulse-momentum'],
        feedbackCorrect:
          'Exactly. Same momentum killed means the same impulse J = Δp. Since J = F·Δt, spreading it over a longer Δt means a smaller force — that is why keepers cushion with soft hands.',
        feedbackByOption: {
          'more-j-cushion': 'No — both kill the same momentum, so J = Δp is identical. Only the force changes with the contact time.',
          'same-f': 'Not quite. J = F·Δt is fixed, so a longer contact time gives a SMALLER force, not the same.',
          'less-j-cushion': 'Impulse is the momentum removed; that is the same for both. The cushion changes the force, not the impulse.',
        },
        hint: 'J = Δp is fixed by the shot. J = F·Δt, so force and contact time trade off.',
      },
      {
        id: 'gk-numeric',
        kind: 'numeric',
        prompt: 'A shot (ball m = 0.43 kg) flies in at v = 30 m/s. What impulse must your gloves apply to hold it dead? (J = m·v)',
        unitLabel: 'N·s',
        correctAnswer: 12.9,
        tolerance: 1,
        nearMissTolerance: 2,
        conceptTags: ['impulse-momentum'],
        feedbackCorrect: 'Correct. J = Δp = m·v = 0.43 × 30 = 12.9 N·s. That is the impulse to bring the ball to rest.',
        feedbackIncorrect: 'Use J = m·v = 0.43 × 30. The impulse equals the momentum you remove.',
        feedbackNearMiss: 'Close. J = m·v = 0.43 × 30 = 12.9 N·s.',
        hint: 'J = m·v = 0.43 × 30.',
      },
      {
        id: 'gk-challenge',
        kind: 'challenge',
        prompt: 'Make a save: commit a direction with 1-3, then solve the impulse (J = m·v) or the hand force (F = J/Δt) to hold the shot.',
        goalDescription: 'Pull off one clean save.',
        conceptTags: ['impulse-momentum'],
        feedbackCorrect:
          'Save made! You took the shot’s momentum away with the right impulse — J = Δp = F·Δt.',
        feedbackIncorrect:
          'Beaten. Misjudge the impulse and your hands arrive wrong. Solve J = m·v, or the force F = J/Δt, for the save you committed to.',
        hint: 'Impulse J = Δp = m·v, and J = F·Δt so F = J/Δt.',
      },
      {
        id: 'gk-quiz',
        kind: 'quiz',
        prompt: 'Final Quiz: Goalkeeping & Impulse',
      },
      {
        id: 'gk-summary',
        kind: 'summary',
        prompt: 'Goalkeeping mastered',
        body: 'You turned a save into impulse–momentum: a shot’s momentum p = m·v must be removed by an equal impulse J = Δp, and since J = F·Δt, soft hands over a longer time mean less force. You read the shot, committed, and applied the impulse to hold it. That is the last skill — time to put them together.',
      },
    ],
  },
}

export const LESSON_ORDER = UNITS.map((u) => u.lessonId)

export function lessonForUnit(unitId: string): Lesson {
  const unit = UNITS.find((u) => u.id === unitId)
  return LESSONS[unit!.lessonId]
}
