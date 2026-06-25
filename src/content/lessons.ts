import type { Lesson, Unit, SimState } from '../types'
import { energy, frictionlessFinalSpeed, circuit } from '../lib/physics'

export const UNITS: Unit[] = [
  {
    id: 'kinematics',
    index: 0,
    name: 'Kinematics',
    blurb: 'Penalty Physics: Score the Goal',
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
    blurb: 'Ground Pass: Weight the Pass',
    lessonId: 'lesson-forces',
  },
  {
    id: 'energy',
    index: 3,
    name: 'Energy',
    blurb: 'Build the Ramp',
    lessonId: 'lesson-energy',
  },
  {
    id: 'circuits',
    index: 4,
    name: 'Circuits',
    blurb: 'Light the Bulb',
    lessonId: 'lesson-circuits',
  },
]

export const UNIT_THEME: Record<string, { icon: string; accent: string; tagline: string }> = {
  kinematics: { icon: '⚽', accent: '#22c55e', tagline: 'Score the goal' },
  'motion-graphs': { icon: '📈', accent: '#06b6d4', tagline: 'Lead the runner' },
  forces: { icon: '📦', accent: '#ef4444', tagline: 'Weight the pass' },
  energy: { icon: '⚡', accent: '#10b981', tagline: 'Convert energy' },
  circuits: { icon: '💡', accent: '#8b5cf6', tagline: 'Close the loop' },
}

const num = (s: SimState, k: string): number => Number(s[k] ?? 0)

export const LESSONS: Record<string, Lesson> = {
  'lesson-projectile': {
    id: 'lesson-projectile',
    unitId: 'kinematics',
    title: 'Penalty Physics: Score the Goal',
    estimatedMinutes: 7,
    sim: 'soccer',
    defaultSimState: { power: 22, angle: 18, goals: 0 },
    challengeGoal: (s) => num(s, 'goals') >= 1,
    steps: [
      {
        id: 'proj-concept',
        kind: 'concept',
        prompt: 'A struck ball is projectile motion',
        body: 'Once your foot leaves the ball, only gravity acts on it. The strike splits into a horizontal velocity vₓ that carries it to goal (never changes) and a vertical velocity v_y that lifts it (gravity pulls it back down). Tune both so the ball is under the crossbar when it arrives.',
      },
      {
        id: 'proj-sandbox',
        kind: 'sandbox',
        prompt: 'Step up to the penalty spot: pick a spot in the goal, lock the power meter, then solve the strike.',
        body: '',
      },
      {
        id: 'proj-prediction',
        kind: 'prediction',
        prompt: 'Two penalties leave your boot at the same speed, one at 12°, one at 40°. The goal is 11 m away and you want a fast shot that stays under the bar and beats the keeper. Which angle is better?',
        options: [
          { id: 'flat', label: '12°: flatter, so more of the speed is horizontal: fast and low' },
          { id: 'steep', label: '40°: a high, looping ball' },
          { id: 'same', label: 'No difference, the speed is the same' },
          { id: 'neither', label: 'Neither can reach the goal from 16 m' },
        ],
        correctOptionId: 'flat',
        conceptTags: ['projectile-horizontal-vertical-independence', 'projectile-time-of-flight'],
        feedbackCorrect:
          'Right. At 12°, most of the speed goes into vx, so the ball travels fast and stays low, reaching the goal quickly and under the bar, giving the keeper little time. The 40° kick puts speed into vy, looping high and slow: easy to claim or it sails over.',
        feedbackByOption: {
          steep: 'A 40° kick spends speed climbing (big vy), so it arrives high and slow, likely over the bar or an easy catch. For pace under the bar you want a flatter angle with more vx.',
          same: 'Same speed, but the angle decides how it splits between vx and vy. That split sets how fast and how high the ball arrives, so angle matters a lot.',
          neither: 'Both easily reach 11 m, so try it. The real question is which beats the keeper: the fast, low one.',
        },
        hint: 'More horizontal speed (vx) means a faster, lower shot. Which angle puts more of the speed into vx, small or large?',
      },
      {
        id: 'proj-numeric',
        kind: 'numeric',
        prompt: 'You strike the ball at 20 m/s at 20° above the ground. What is the upward part of the velocity, vy = v·sinθ? (sin 20° ≈ 0.34)',
        unitLabel: 'm/s',
        correctAnswer: 6.8,
        tolerance: 0.4,
        nearMissTolerance: 1.2,
        conceptTags: ['projectile-horizontal-vertical-independence'],
        feedbackCorrect:
          'Correct. vy = 20 × sin20° ≈ 20 × 0.34 ≈ 6.8 m/s goes upward, while vx = 20 × cos20° ≈ 18.8 m/s drives the ball at the goal. Those components combine to your 20 m/s strike.',
        feedbackIncorrect:
          'Not yet. The upward part is vy = v·sinθ = 20 × sin20°. Use sin20° ≈ 0.34.',
        feedbackNearMiss:
          'Close. Make sure you used sinθ for the vertical part (not cosθ): 20 × 0.34.',
        hint: 'Vertical velocity uses sine: vy = v·sinθ = 20 × 0.34.',
      },
      {
        id: 'proj-challenge',
        kind: 'challenge',
        prompt: 'Score the penalty. Pick a spot in the goal, lock the meter, then solve the strike.',
        goalDescription: 'Score 1 goal: land the ball in the glowing ring.',
        conceptTags: ['projectile-range', 'projectile-time-of-flight'],
        feedbackCorrect:
          'Top corner! With one value locked on the meter, you found the one value of the other that put the ball at the right height after distance d, landing it right in your ring. Projectile motion, applied.',
        feedbackIncorrect:
          'Keep going. Compute the height your ball reaches at the goal, y = h₀ + vy·t − ½g·t², and make it match your spot’s h: overshoot sails over, undershoot drops short, and either way the keeper saves it.',
        hint: 'One value is locked by the meter, so work out the other by hand so y ≈ h at distance d. vx = v·cosθ, t = d/vx, then y = h₀ + vy·t − ½g·t². Use the on-screen calculator if you need it.',
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
        body: 'Plot any player against time and you get a straight line whose slope is their velocity: steeper means faster, and where the line starts is their head start x₀. A through-ball is two lines — the runner and your pass — and it connects exactly where those lines cross.',
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
        prompt: 'A teammate is making a run into space. To make the ball meet him further upfield (deeper in the space), how should you weight the pass?',
        options: [
          { id: 'soft', label: 'Less pace: a gentler line crosses his later and further along' },
          { id: 'hard', label: 'More pace: a steeper line' },
          { id: 'match', label: 'Exactly his speed' },
          { id: 'back', label: 'A backward pass' },
        ],
        correctOptionId: 'soft',
        conceptTags: ['graph-slope-as-velocity', 'graph-velocity-direction'],
        feedbackCorrect:
          'Right. A gentler pass line has a smaller slope, so it crosses the runner’s line later in time and higher up the pitch: the ball meets him deeper in space.',
        feedbackByOption: {
          hard: 'More pace makes your line steeper, so it overtakes the runner sooner: the ball meets him early, at his feet, with no space to run onto.',
          match: 'If your line has the same slope as his, the lines stay parallel and never cross: the ball never reaches him.',
          back: 'A backward pass slopes the wrong way and heads away from the run entirely.',
        },
        hint: 'Smaller slope = the lines cross later = further up the pitch.',
      },
      {
        id: 'mg-numeric',
        kind: 'numeric',
        prompt: 'A teammate starts 8 m ahead of you and runs at a steady 4 m/s. Using x = x₀ + v·t, what is his position after 4 s?',
        unitLabel: 'm',
        correctAnswer: 24,
        tolerance: 0.5,
        nearMissTolerance: 2,
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
    title: 'Ground Pass: Weight the Pass',
    estimatedMinutes: 6,
    sim: 'forces',
    defaultSimState: { connections: 0 },
    challengeGoal: (s) => num(s, 'connections') >= 1,
    steps: [
      {
        id: 'force-concept',
        kind: 'concept',
        prompt: 'A ground pass is friction at work',
        body: 'Once the ball leaves your foot, friction is the only push along the grass, and it always opposes motion: a steady deceleration a = μg. So the ball constantly bleeds speed, and how fast it arrives depends on how hard you start it. Using v² = v₀² − 2·a·d, the weight of the pass (v₀) sets the pace it reaches your teammate (v).',
      },
      {
        id: 'force-sandbox',
        kind: 'sandbox',
        prompt: 'Weight a ground pass: lock the meter, then solve the kick so it reaches your teammate at the right pace.',
        body: '',
      },
      {
        id: 'force-prediction',
        kind: 'prediction',
        prompt: 'Same teammate, same distance. To make the ball arrive softer (slower) for an easy first touch, how should you weight the pass?',
        options: [
          { id: 'soft', label: 'Less pace off your foot: friction bleeds it down to a gentler arrival' },
          { id: 'hard', label: 'More pace: drive it harder' },
          { id: 'same', label: 'It makes no difference, friction sets the speed' },
          { id: 'back', label: 'Add backspin so it speeds up' },
        ],
        correctOptionId: 'soft',
        conceptTags: ['force-friction', 'force-net-force'],
        feedbackCorrect:
          'Right. Friction removes the same amount of speed over a fixed distance, so a softer kick (smaller v₀) arrives slower. v² = v₀² − 2·a·d: lower v₀ means lower arrival v.',
        feedbackByOption: {
          hard: 'More pace makes it arrive faster and harder to control, not softer. To arrive gently you start it gently.',
          same: 'Friction sets the deceleration, but your kick sets the starting speed. v² = v₀² − 2·a·d, so v₀ controls the arrival pace.',
          back: 'Friction only ever slows a rolling ball down; it never speeds it up. Weight comes from your kick.',
        },
        hint: 'Over a fixed distance friction takes a fixed bite out of v². Smaller starting speed → smaller arrival speed.',
      },
      {
        id: 'force-numeric',
        kind: 'numeric',
        prompt: 'You pass the ball at 6 m/s along grass that decelerates it at 3 m/s². How far does it roll before it stops? (d = v₀² / 2a)',
        unitLabel: 'm',
        correctAnswer: 6,
        tolerance: 0.3,
        nearMissTolerance: 1.5,
        conceptTags: ['force-friction'],
        feedbackCorrect: 'Correct. d = v₀² / (2a) = 6² / (2×3) = 36 / 6 = 6 m. That is exactly where a dead-weight pass would come to rest.',
        feedbackIncorrect: 'Use d = v₀² / (2a) = 6² / (2×3). Square the speed, then divide by twice the deceleration.',
        feedbackNearMiss: 'Close. d = v₀² / (2a) = 36 / 6. Make sure you squared the 6 first.',
        hint: 'Set v = 0 in v² = v₀² − 2·a·d and solve for d: d = v₀² / (2a).',
      },
      {
        id: 'force-challenge',
        kind: 'challenge',
        prompt: 'Play the ground pass: weight it so friction leaves it at the right pace in your teammate’s space.',
        goalDescription: 'Connect one weighted ground pass into the control zone.',
        conceptTags: ['force-friction', 'force-net-force'],
        feedbackCorrect:
          'Weighted to perfection. You used v² = v₀² − 2·a·d to pick a kick speed that friction bled down to exactly the pace your teammate wanted.',
        feedbackIncorrect:
          'Not controlled. Underweight it and friction stops it short; overweight it and it runs through the zone. Solve v₀ so the arrival pace lands in the window.',
        hint: 'Required kick speed v₀ = √(v*² + 2·a·d), where a = μg. Read the distance and friction, then weight it.',
      },
      {
        id: 'force-summary',
        kind: 'summary',
        prompt: 'Pass weight mastered',
        body: 'You treated friction as a steady deceleration, used v² = v₀² − 2·a·d to control how a ground pass arrives, and weighted a pass into a teammate’s feet. Next up: Energy.',
      },
    ],
  },

  'lesson-energy': {
    id: 'lesson-energy',
    unitId: 'energy',
    title: 'Energy: Build the Ramp',
    estimatedMinutes: 6,
    sim: 'energy',
    defaultSimState: { height: 5, mass: 2, friction: 0, gravity: 9.8 },
    challengeGoal: (s) => {
      const hasFriction = num(s, 'friction') > 0.001
      const v = hasFriction
        ? energy(num(s, 'mass'), num(s, 'height'), num(s, 'friction'), num(s, 'gravity')).finalSpeed
        : frictionlessFinalSpeed(num(s, 'height'), num(s, 'gravity'))
      return !hasFriction && Math.abs(v - 8) <= 0.4
    },
    steps: [
      {
        id: 'energy-concept',
        kind: 'concept',
        prompt: 'Energy converts from potential to kinetic',
        body: 'At the top of a ramp the object has gravitational potential energy (mgh). As it descends, that converts into kinetic energy (½mv²). With no friction, all of it becomes motion. Friction siphons some off as thermal energy (heat).',
      },
      {
        id: 'energy-sandbox',
        kind: 'sandbox',
        prompt: 'Change height, mass, and friction. Watch the energy bars.',
        body: 'The bar chart shows potential, kinetic, and thermal energy. Notice how the final speed depends on height and friction, but not the way you might expect for mass.',
      },
      {
        id: 'energy-prediction',
        kind: 'prediction',
        prompt: 'On a frictionless ramp, you double the mass. What happens to the final speed at the bottom?',
        options: [
          { id: 'same', label: 'It stays the same' },
          { id: 'double', label: 'It doubles' },
          { id: 'half', label: 'It is cut in half' },
          { id: 'quad', label: 'It quadruples' },
        ],
        correctOptionId: 'same',
        conceptTags: ['energy-conservation'],
        feedbackCorrect:
          'Correct. mgh = ½mv², the mass cancels, so v = √(2gh) regardless of mass.',
        feedbackByOption: {
          double: 'Tempting, but mass appears on both sides of mgh = ½mv² and cancels out.',
          half: 'Mass cancels in the energy equation, so the final speed does not depend on it.',
          quad: 'No. Set mgh = ½mv², cancel m, and you get v = √(2gh), independent of mass.',
        },
        hint: 'Write mgh = ½mv² and cancel the mass on both sides.',
      },
      {
        id: 'energy-numeric',
        kind: 'numeric',
        prompt: 'An object slides down a frictionless 5 m height. Final speed? (v = √(2gh), g = 9.8)',
        unitLabel: 'm/s',
        correctAnswer: 9.9,
        tolerance: 0.4,
        nearMissTolerance: 1.5,
        conceptTags: ['energy-conservation'],
        feedbackCorrect: 'Correct. v = √(2·9.8·5) = √98 ≈ 9.9 m/s.',
        feedbackIncorrect: 'Use v = √(2gh) = √(2 · 9.8 · 5).',
        feedbackNearMiss: 'Close. Remember the square root: v = √(2gh), not 2gh.',
        hint: 'Compute 2·9.8·5 = 98, then take the square root.',
      },
      {
        id: 'energy-challenge',
        kind: 'challenge',
        prompt: 'With friction off, set the ramp height so the object reaches about 8 m/s at the bottom.',
        goalDescription: 'Frictionless, final speed within 0.4 of 8 m/s.',
        conceptTags: ['energy-conservation', 'energy-friction-loss'],
        feedbackCorrect:
          'Perfect. v = √(2gh), so 8 m/s needs h ≈ 3.3 m. All the potential energy became kinetic.',
        feedbackIncorrect:
          'Turn friction off so no energy is lost, then adjust the height until the final speed readout hits 8 m/s.',
        hint: 'Solve 8 = √(2·9.8·h) → h = 64 / (2·9.8) ≈ 3.3 m. Keep friction at 0.',
      },
      {
        id: 'energy-summary',
        kind: 'summary',
        prompt: 'Energy mastered',
        body: 'You tracked energy from potential to kinetic, saw why mass cancels, and tuned a target speed. Next up: Circuits.',
      },
    ],
  },

  'lesson-circuits': {
    id: 'lesson-circuits',
    unitId: 'circuits',
    title: 'Circuits: Light the Bulb',
    estimatedMinutes: 6,
    sim: 'circuits',
    defaultSimState: {
      closed: false,
      layout: 'series',
      bulbCount: 1,
      voltage: 6,
      resistance: 6,
    },
    challengeGoal: (s) => {
      const r = circuit(
        num(s, 'voltage'),
        num(s, 'bulbCount'),
        num(s, 'resistance'),
        s.layout === 'parallel' ? 'parallel' : 'series',
        Boolean(s.closed),
      )
      return r.lit
    },
    steps: [
      {
        id: 'circuit-concept',
        kind: 'concept',
        prompt: 'Current needs a complete loop',
        body: 'A bulb only lights when current can flow in a complete loop from one terminal of the battery, through the bulb, and back to the other terminal. Open the loop anywhere and the current stops. Ohm’s law (V = I·R) sets how much current flows.',
      },
      {
        id: 'circuit-sandbox',
        kind: 'sandbox',
        prompt: 'Close the switch and try series vs parallel.',
        body: 'Toggle the switch to complete the loop. Add a second bulb and compare series and parallel, watching how brightness and current change.',
      },
      {
        id: 'circuit-prediction',
        kind: 'prediction',
        prompt: 'Two identical bulbs on the same battery: which layout makes each bulb brighter?',
        options: [
          { id: 'parallel', label: 'Parallel' },
          { id: 'series', label: 'Series' },
          { id: 'same', label: 'Both the same' },
          { id: 'neither', label: 'Neither lights' },
        ],
        correctOptionId: 'parallel',
        conceptTags: ['circuits-series-parallel'],
        feedbackCorrect:
          'Right. In parallel each bulb sees the full battery voltage, so each is as bright as a single bulb. In series they share the voltage and dim.',
        feedbackByOption: {
          series: 'In series the bulbs split the voltage, so each gets less and they dim.',
          same: 'Layout matters: parallel bulbs get full voltage each; series bulbs share it.',
          neither: 'Both layouts light as long as the loop is closed, but parallel is brighter per bulb.',
        },
        hint: 'In parallel, each bulb connects directly across the battery and gets the full voltage.',
      },
      {
        id: 'circuit-numeric',
        kind: 'numeric',
        prompt: 'A 12 V battery drives a single bulb of 4 Ω. What current flows?',
        unitLabel: 'amps',
        correctAnswer: 3,
        tolerance: 0.1,
        nearMissTolerance: 0.6,
        conceptTags: ['circuits-ohms-law'],
        feedbackCorrect: 'Correct. Ohm’s law: I = V / R = 12 V ÷ 4 Ω = 3 A.',
        feedbackIncorrect: 'Use Ohm’s law: I = V / R = 12 ÷ 4.',
        feedbackNearMiss: 'Close. I = V / R, so divide voltage by resistance exactly.',
        hint: 'I = V / R.',
      },
      {
        id: 'circuit-challenge',
        kind: 'challenge',
        prompt: 'Build a working circuit so the bulb lights up.',
        goalDescription: 'Close the loop so current flows and the bulb is lit.',
        conceptTags: ['circuits-closed-loop', 'circuits-ohms-law'],
        feedbackCorrect:
          'Lit! With the switch closed, current has a complete loop and flows through the bulb.',
        feedbackIncorrect:
          'The loop is open, so no current flows. Close the switch to complete the path from the battery through the bulb and back.',
        hint: 'Toggle the switch to closed so the loop is complete.',
      },
      {
        id: 'circuit-summary',
        kind: 'summary',
        prompt: 'Circuits mastered: course complete!',
        body: 'You built a closed loop, applied Ohm’s law, and compared series with parallel. That completes all five Physics I units.',
      },
    ],
  },
}

export const LESSON_ORDER = UNITS.map((u) => u.lessonId)

export function lessonForUnit(unitId: string): Lesson {
  const unit = UNITS.find((u) => u.id === unitId)
  return LESSONS[unit!.lessonId]
}
