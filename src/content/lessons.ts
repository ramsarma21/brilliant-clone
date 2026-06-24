import type { Lesson, Unit, SimState } from '../types'
import { forces, energy, frictionlessFinalSpeed, circuit } from '../lib/physics'

export const UNITS: Unit[] = [
  {
    id: 'kinematics',
    index: 0,
    name: 'Kinematics',
    blurb: 'Free Kick Physics: Score the Goal',
    lessonId: 'lesson-projectile',
  },
  {
    id: 'motion-graphs',
    index: 1,
    name: 'Motion Graphs',
    blurb: 'Match the Motion',
    lessonId: 'lesson-motion-graphs',
  },
  {
    id: 'forces',
    index: 2,
    name: 'Forces',
    blurb: 'Push the Crate',
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
  'motion-graphs': { icon: '📈', accent: '#06b6d4', tagline: 'Read the slope' },
  forces: { icon: '📦', accent: '#ef4444', tagline: 'Push & balance' },
  energy: { icon: '⚡', accent: '#10b981', tagline: 'Convert energy' },
  circuits: { icon: '💡', accent: '#8b5cf6', tagline: 'Close the loop' },
}

const num = (s: SimState, k: string): number => Number(s[k] ?? 0)

export const LESSONS: Record<string, Lesson> = {
  'lesson-projectile': {
    id: 'lesson-projectile',
    unitId: 'kinematics',
    title: 'Free Kick Physics: Score the Goal',
    estimatedMinutes: 7,
    sim: 'soccer',
    defaultSimState: { power: 22, angle: 18, goals: 0 },
    challengeGoal: (s) => num(s, 'goals') >= 1,
    steps: [
      {
        id: 'proj-concept',
        kind: 'concept',
        prompt: 'A struck ball is projectile motion',
        body: 'The instant your foot leaves the ball, only gravity acts on it. Your strike splits into two independent parts: a horizontal velocity vx that carries the ball toward the goal, and a vertical velocity vy that lifts it. vx never changes in flight; gravity steadily pulls vy down. To score, those parts must be tuned so the ball is still below the crossbar (under 2.44 m) when it reaches the goal — and moving fast enough that the keeper can’t react.',
      },
      {
        id: 'proj-sandbox',
        kind: 'sandbox',
        prompt: 'Take the free kick: dribble in, pick a spot, then solve the angle and force.',
        body: 'Dribble in with ← →, beat the defenders, and press Space. Click the spot you want — it becomes a glowing ring with its distance d and height h. Then compute the launch angle θ and strike force v that land the ball in the ring: vₓ = v·cosθ, t = d/vₓ, y = h₀ + vy·t − ½g·t².',
      },
      {
        id: 'proj-prediction',
        kind: 'prediction',
        prompt: 'Two free kicks leave your boot at the same speed — one at 12°, one at 40°. The goal is 16 m away and you want a fast shot that stays under the bar and beats the keeper. Which angle is better?',
        options: [
          { id: 'flat', label: '12° — flatter, so more of the speed is horizontal: fast and low' },
          { id: 'steep', label: '40° — a high, looping ball' },
          { id: 'same', label: 'No difference, the speed is the same' },
          { id: 'neither', label: 'Neither can reach the goal from 16 m' },
        ],
        correctOptionId: 'flat',
        conceptTags: ['projectile-horizontal-vertical-independence', 'projectile-time-of-flight'],
        feedbackCorrect:
          'Right. At 12°, most of the speed goes into vx, so the ball travels fast and stays low — it reaches the goal quickly and under the bar, giving the keeper little time. The 40° kick puts speed into vy, looping high and slow: easy to claim or it sails over.',
        feedbackByOption: {
          steep: 'A 40° kick spends speed climbing (big vy), so it arrives high and slow — likely over the bar or an easy catch. For pace under the bar you want a flatter angle with more vx.',
          same: 'Same speed, but the angle decides how it splits between vx and vy. That split sets how fast and how high the ball arrives — so angle matters a lot.',
          neither: 'Both easily reach 16 m — try it. The real question is which beats the keeper: the fast, low one.',
        },
        hint: 'More horizontal speed (vx) means a faster, lower shot. Which angle puts more of the speed into vx — small or large?',
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
          'Close — make sure you used sinθ for the vertical part (not cosθ): 20 × 0.34.',
        hint: 'Vertical velocity uses sine: vy = v·sinθ = 20 × 0.34.',
      },
      {
        id: 'proj-challenge',
        kind: 'challenge',
        prompt: 'Score a goal. Beat the defenders, choose a corner, then solve the strike.',
        goalDescription: 'Score 1 goal: dodge the defenders with ← →, press Space to shoot, click a spot, then compute the angle and force so the ball lands inside the glowing ring at that height and distance.',
        conceptTags: ['projectile-range', 'projectile-time-of-flight'],
        feedbackCorrect:
          'Top corner! You picked a spot, then computed an angle and force that put the ball at the right height after distance d — landing it right in your ring. Projectile motion, applied.',
        feedbackIncorrect:
          'Keep going. Compute the height your ball reaches at the goal, y = h₀ + vy·t − ½g·t², and make it match your spot’s h so the ball lands inside the glowing ring: over 2.44 m clears the bar, too low slams into the turf, and in-goal-but-outside-the-ring gets saved.',
        hint: 'Work out θ and v by hand so y ≈ h at distance d — land it inside the ring. vx = v·cosθ, t = d/vx, then y = h₀ + vy·t − ½g·t². Use the on-screen calculator if you need it.',
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
    title: 'Motion Graphs: Match the Motion',
    estimatedMinutes: 6,
    sim: 'motion-graph',
    defaultSimState: { p0: 0, p1: 2, p2: 6, p3: 7 },
    challengeGoal: (s) => {
      const d1 = num(s, 'p1') - num(s, 'p0')
      const d2 = num(s, 'p2') - num(s, 'p1')
      const d3 = num(s, 'p3') - num(s, 'p2')
      const deltas = [d1, d2, d3]
      const allForward = deltas.every((d) => d >= 1.5)
      const spread = Math.max(...deltas) - Math.min(...deltas)
      return allForward && spread <= 1
    },
    steps: [
      {
        id: 'graph-concept',
        kind: 'concept',
        prompt: 'Slope on a position–time graph is velocity',
        body: 'On a position–time graph, the steepness of the line tells you how fast the object moves. A steeper upward slope means faster forward motion. A flat line means the object is stopped. A downward slope means it moves backward.',
      },
      {
        id: 'graph-sandbox',
        kind: 'sandbox',
        prompt: 'Drag the graph points. Watch the dot move along the track.',
        body: 'Each point sets the object’s position at that time. Drag them up or down and watch the track dot replay the motion you drew.',
      },
      {
        id: 'graph-prediction',
        kind: 'prediction',
        prompt: 'A position–time graph is a straight line sloping steeply upward. What does that describe?',
        options: [
          { id: 'fast', label: 'Moving forward quickly at constant velocity' },
          { id: 'slow', label: 'Moving forward slowly' },
          { id: 'stopped', label: 'Standing still' },
          { id: 'back', label: 'Moving backward' },
        ],
        correctOptionId: 'fast',
        conceptTags: ['graph-slope-as-velocity'],
        feedbackCorrect:
          'Exactly. A straight, steep, upward line means a large constant velocity in the forward direction.',
        feedbackByOption: {
          slow: 'A slow object would have a gentle slope, not a steep one. Steeper means faster.',
          stopped: 'A stopped object draws a flat horizontal line, since position does not change.',
          back: 'Backward motion slopes downward (position decreasing), not upward.',
        },
        hint: 'Slope = change in position ÷ change in time = velocity.',
      },
      {
        id: 'graph-numeric',
        kind: 'numeric',
        prompt: 'An object goes from 2 m to 14 m in 4 s. What is its average velocity?',
        unitLabel: 'm/s',
        correctAnswer: 3,
        tolerance: 0.3,
        nearMissTolerance: 1,
        conceptTags: ['graph-slope-as-velocity'],
        feedbackCorrect: 'Correct. Average velocity = Δposition ÷ Δtime = (14 − 2) ÷ 4 = 3 m/s.',
        feedbackIncorrect: 'Use velocity = (final − initial position) ÷ time = (14 − 2) ÷ 4.',
        feedbackNearMiss: 'Close. Make sure you divide the 12 m change by the full 4 s.',
        hint: 'Velocity is the slope: rise (12 m) over run (4 s).',
      },
      {
        id: 'graph-challenge',
        kind: 'challenge',
        prompt: 'Shape the graph so the object moves forward at a steady, constant velocity.',
        goalDescription: 'Make all three segments rise by a similar amount (constant positive slope).',
        conceptTags: ['graph-slope-as-velocity', 'graph-velocity-direction'],
        feedbackCorrect:
          'Constant velocity achieved. Equal-sized upward steps mean the slope, and therefore the velocity, never changes.',
        feedbackIncorrect:
          'Constant velocity needs a straight line: each step should rise by the same amount in the forward direction.',
        hint: 'Drag the points so the line is straight and rising — equal gaps between each.',
      },
      {
        id: 'graph-summary',
        kind: 'summary',
        prompt: 'Motion graphs mastered',
        body: 'You connected slope to velocity, computed an average velocity, and drew constant motion. Next up: Forces.',
      },
    ],
  },

  'lesson-forces': {
    id: 'lesson-forces',
    unitId: 'forces',
    title: 'Forces: Push the Crate',
    estimatedMinutes: 6,
    sim: 'forces',
    defaultSimState: { force: 20, mass: 5, friction: 0.3, gravity: 9.8 },
    challengeGoal: (s) => {
      const r = forces(num(s, 'force'), num(s, 'mass'), num(s, 'friction'), num(s, 'gravity'))
      return r.isMoving && Math.abs(r.acceleration - 2) <= 0.25
    },
    steps: [
      {
        id: 'force-concept',
        kind: 'concept',
        prompt: 'Net force, not motion, causes acceleration',
        body: 'Newton’s second law: a = F_net / m. An object keeps moving on its own; it only speeds up or slows down when the net force is non-zero. Friction opposes motion, so the net force is the applied force minus friction.',
      },
      {
        id: 'force-sandbox',
        kind: 'sandbox',
        prompt: 'Adjust force, mass, and friction. Watch acceleration change.',
        body: 'The arrows show applied force and friction. Below the static-friction threshold the crate stays put. Push harder and it accelerates.',
      },
      {
        id: 'force-prediction',
        kind: 'prediction',
        prompt: 'A crate slides across the floor at constant velocity. What is the net force on it?',
        options: [
          { id: 'zero', label: 'Zero' },
          { id: 'forward', label: 'Forward, equal to the applied force' },
          { id: 'back', label: 'Backward, equal to friction' },
          { id: 'depends', label: 'It depends on the mass' },
        ],
        correctOptionId: 'zero',
        conceptTags: ['force-net-force'],
        feedbackCorrect:
          'Right. Constant velocity means zero acceleration, so the net force is zero — the applied force exactly cancels friction.',
        feedbackByOption: {
          forward: 'If the net force were forward, it would be speeding up. Constant velocity means forces balance.',
          back: 'Friction is there, but the applied force cancels it. The net force is zero, not backward.',
          depends: 'Mass affects how much force is needed to accelerate, but constant velocity always means zero net force.',
        },
        hint: 'Constant velocity means zero acceleration. What does a = F_net/m say about F_net?',
      },
      {
        id: 'force-numeric',
        kind: 'numeric',
        prompt: 'A net force of 12 N acts on a 4 kg crate. What is its acceleration?',
        unitLabel: 'm/s²',
        correctAnswer: 3,
        tolerance: 0.2,
        nearMissTolerance: 1,
        conceptTags: ['force-net-force'],
        feedbackCorrect: 'Correct. a = F_net / m = 12 N ÷ 4 kg = 3 m/s².',
        feedbackIncorrect: 'Use Newton’s second law: a = F_net / m = 12 ÷ 4.',
        feedbackNearMiss: 'Close. Divide the net force by the mass exactly: 12 ÷ 4.',
        hint: 'a = F_net / m.',
      },
      {
        id: 'force-challenge',
        kind: 'challenge',
        prompt: 'Set force, mass, and friction so the crate accelerates at about 2 m/s².',
        goalDescription: 'Get the crate moving with acceleration within 0.25 of 2 m/s².',
        conceptTags: ['force-net-force', 'force-friction'],
        feedbackCorrect:
          'Done. You pushed past the friction threshold and tuned the net force so a = F_net/m ≈ 2 m/s².',
        feedbackIncorrect:
          'First push hard enough to overcome friction, then balance force and mass so the acceleration readout is near 2 m/s².',
        hint: 'Lower friction or mass, or raise the force. Watch the acceleration readout.',
      },
      {
        id: 'force-summary',
        kind: 'summary',
        prompt: 'Forces mastered',
        body: 'You separated motion from net force, applied F = ma, and tuned a real acceleration. Next up: Energy.',
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
        body: 'The bar chart shows potential, kinetic, and thermal energy. Notice how the final speed depends on height and friction — but not the way you might expect for mass.',
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
          'Correct. mgh = ½mv² — the mass cancels, so v = √(2gh) regardless of mass.',
        feedbackByOption: {
          double: 'Tempting, but mass appears on both sides of mgh = ½mv² and cancels out.',
          half: 'Mass cancels in the energy equation, so the final speed does not depend on it.',
          quad: 'No — set mgh = ½mv², cancel m, and you get v = √(2gh), independent of mass.',
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
        body: 'Toggle the switch to complete the loop. Add a second bulb and compare series and parallel — watch how brightness and current change.',
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
          neither: 'Both layouts light as long as the loop is closed — but parallel is brighter per bulb.',
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
        feedbackNearMiss: 'Close. I = V / R — divide voltage by resistance exactly.',
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
        prompt: 'Circuits mastered — course complete!',
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
