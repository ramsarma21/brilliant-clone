// Player name bank. Each club player draws a first + last name at random, so with
// 60 × 60 = 3,600 combinations (× the appearance permutations) it's effectively
// impossible to ever roll the same player twice. First names span the globe (it's
// soccer, after all) but say nothing about skin tone — looks are rolled separately.
// Last names are physics-flavoured twists on ordinary surnames.

export const FIRST_NAMES: string[] = [
  'Johnathan', 'James', 'William', 'Michael', 'David', 'Daniel', 'Thomas', 'Joseph',
  'Henry', 'George', 'Mohammed', 'Ali', 'Omar', 'Youssef', 'Ibrahim', 'Hassan',
  'Karim', 'Tariq', 'Diego', 'Carlos', 'Javier', 'Mateo', 'Santiago', 'Luis',
  'Rafael', 'Sergio', 'Luca', 'Marco', 'Matteo', 'Giovanni', 'Lorenzo', 'Alessandro',
  'Kai', 'Lukas', 'Felix', 'Jonas', 'Stefan', 'Niklas', 'Pierre', 'Olivier',
  'Antoine', 'Hugo', 'Theo', 'Sven', 'Erik', 'Magnus', 'Bjorn', 'Kenji',
  'Hiroshi', 'Takumi', 'Sota', 'Chibuzo', 'Kwame', 'Kofi', 'Tunde', 'Sipho',
  'Ravi', 'Arjun', 'Vikram', 'Rohan',
]

export const LAST_NAMES: string[] = [
  'Physicson', 'Motions', 'Kinematicson', 'Newtonberg', 'Jouleson', 'Wattkins',
  'Ampson', 'Voltaire', 'Ohmsworth', 'Forceman', 'Maxwellton', 'Velocci',
  'Accelerez', 'Inertson', 'Gravison', 'Momentov', 'Impulski', 'Frictionov',
  'Torqueson', 'Energetti', 'Quantby', 'Photonelli', 'Electronov', 'Protonio',
  'Neutronson', 'Wavemann', 'Particci', 'Fieldman', 'Frequenza', 'Spectrini',
  'Magnetson', 'Voltzberg', 'Currentano', 'Resistov', 'Capaci', 'Fluxman',
  'Densworth', 'Pascalez', 'Hertzog', 'Faradson', 'Teslano', 'Boltzman',
  'Planckett', 'Curieton', 'Galilei', 'Keplerov', 'Einsteiner', 'Bohrman',
  'Diracson', 'Fermion', 'Higgsby', 'Lorentzo', 'Schrodson', 'Heisenburg',
  'Maxfield', 'Coulombe', 'Gaussman', 'Keplinger', 'Newmanton', 'Vectorov',
]

const pick = <T>(arr: T[], rng: () => number): T => arr[Math.floor(rng() * arr.length)]

export type RolledName = { first: string; last: string; full: string }

/** Roll a random first + last name. Pass a seeded rng for reproducibility. */
export function randomName(rng: () => number = Math.random): RolledName {
  const first = pick(FIRST_NAMES, rng)
  const last = pick(LAST_NAMES, rng)
  return { first, last, full: `${first} ${last}` }
}
