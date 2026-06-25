import type { SimKey } from '../../types'
import type { SimProps } from './types'
import { ProjectileSim } from './ProjectileSim'
import { KinematicsSim } from './KinematicsSim'
import { MotionSim } from './MotionSim'
import { ForcesSim } from './ForcesSim'
import { EnergySim } from './EnergySim'
import { CircuitsSim } from './CircuitsSim'

type Props = SimProps & { sim: SimKey }

export function Sim({ sim, ...rest }: Props) {
  switch (sim) {
    case 'projectile':
      return <ProjectileSim {...rest} />
    case 'soccer':
      return <KinematicsSim {...rest} />
    case 'passing':
      return <MotionSim {...rest} />
    case 'forces':
      return <ForcesSim {...rest} />
    case 'energy':
      return <EnergySim {...rest} />
    case 'circuits':
      return <CircuitsSim {...rest} />
    default:
      return null
  }
}
